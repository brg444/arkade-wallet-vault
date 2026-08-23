import {
  ArkAddress,
  BITCOIN_EMULATOR_PUBKEY,
  DefaultVtxo,
  SingleKey,
  VHTLCV2ContractHandler,
  type IWallet,
} from '@arkade-os/sdk'
import {
  InMemoryAssetSwapRepository,
  RfqSwapManager,
  lightningSendVtxoScript,
  unilateralClaimDelay,
  type RfqQuote,
  type SwapContractRegistry,
} from '@arkade-os/swap'
import { hex } from '@scure/base'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodeVaultLightningInvoice,
  getVaultLightningStatus,
  requestVaultLightningQuote,
  validateVaultLightningRefund,
  vaultLightningSendEnabled,
  wholeSatsFromMillisats,
  withMainnetLightningTransport,
  withVaultRefundAddress,
} from './lightning'
import {
  INVOICE_EXPIRES,
  INVOICE_TIMESTAMP,
  MAINNET_INVOICE,
  completeRequestResult,
  memoryContracts,
  quoteManager,
  refundAddress,
} from './lightningTestUtils'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Lightning SEND release boundary', () => {
  it('is disabled unless the release flag is exactly true', () => {
    expect(vaultLightningSendEnabled(undefined)).toBe(false)
    expect(vaultLightningSendEnabled('TRUE')).toBe(false)
    expect(vaultLightningSendEnabled('1')).toBe(false)
    expect(vaultLightningSendEnabled('true')).toBe(true)
  })

  it('decodes the invoice locally and rejects wrong-network and expired invoices', () => {
    const facts = decodeVaultLightningInvoice(MAINNET_INVOICE, 'bitcoin', INVOICE_TIMESTAMP + 1)
    expect(facts).toEqual({
      raw: MAINNET_INVOICE,
      paymentHash: 'da9fa986cf48f56ad387495f8e840ea9ed10889bf82f67c8a7b10d5d8a27886c',
      amountSats: 2100,
      expiresAt: INVOICE_EXPIRES,
    })
    expect(() => decodeVaultLightningInvoice(MAINNET_INVOICE, 'mutinynet', INVOICE_TIMESTAMP + 1)).toThrow(
      /not for mutinynet/,
    )
    expect(() => decodeVaultLightningInvoice(MAINNET_INVOICE, 'bitcoin', INVOICE_EXPIRES)).toThrow(/expired/)
  })

  it('rejects fractional millisatoshi amounts instead of rounding them down', () => {
    expect(wholeSatsFromMillisats(2_100_000)).toBe(2100)
    try {
      wholeSatsFromMillisats(2_100_001)
      throw new Error('expected fractional invoice rejection')
    } catch (error) {
      expect(error).toMatchObject({ reason: 'fractional_amount' })
    }
  })

  it('overrides only getAddress on a full stock wallet', async () => {
    const identity = SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0')))
    const contracts = { marker: 'stock-contract-manager' }
    const stockAddress = await refundAddress()
    const target = {
      identity,
      marker: 'stock-wallet',
      getAddress: vi.fn(async () => stockAddress),
      getContractManager: vi.fn(function (this: { marker: string }) {
        if (this.marker !== 'stock-wallet') throw new Error('method lost its stock-wallet receiver')
        return Promise.resolve(contracts)
      }),
    } as unknown as IWallet
    const vaultAddress = await refundAddress()
    const adapted = withVaultRefundAddress(target, vaultAddress)

    expect(adapted.identity).toBe(identity)
    expect(await adapted.getAddress()).toBe(vaultAddress)
    expect(target.getAddress).not.toHaveBeenCalled()
    expect(await adapted.getContractManager()).toBe(contracts)
    expect(target.getContractManager).toHaveBeenCalledOnce()
  })

  it('binds the refund address to the advertised Spending script and Operator', async () => {
    const operator = SingleKey.fromPrivateKey(hex.decode('04'.padStart(64, '0')))
    const operatorPubkey = hex.encode(await operator.compressedPublicKey())
    const address = await refundAddress()
    const script = hex.encode(ArkAddress.decode(address).pkScript)
    const status = {
      enrolled: true,
      vaultId: 'vault-lightning',
      network: 'bitcoin',
      spendingArkAddress: address,
      spendingArkScript: script,
    } as import('./types').VaultStatus

    expect(validateVaultLightningRefund(status, 'bitcoin', operatorPubkey).encode()).toBe(address)
    expect(() =>
      validateVaultLightningRefund({ ...status, spendingArkScript: '51'.repeat(34) }, 'bitcoin', operatorPubkey),
    ).toThrow(/pinned script/)
    const otherOperator = SingleKey.fromPrivateKey(hex.decode('07'.padStart(64, '0')))
    const otherOperatorPubkey = hex.encode(await otherOperator.compressedPublicKey())
    expect(() => validateVaultLightningRefund(status, 'bitcoin', otherOperatorPubkey)).toThrow(
      /another Arkade Operator/,
    )
  })

  it('passes the adapted wallet to the package client and retains its authoritative fee and refund facts', async () => {
    const vaultAddress = await refundAddress()
    const identity = SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0')))
    const { contracts } = memoryContracts()
    const repository = new InMemoryAssetSwapRepository()
    const { manager } = quoteManager(repository, contracts)
    const wallet = withVaultRefundAddress(
      {
        identity,
        getAddress: async () => 'ark1wrong',
        getContractManager: async () => contracts,
      } as unknown as IWallet,
      vaultAddress,
    )
    const result = await completeRequestResult(wallet, contracts)
    const requester = vi.fn(async (receivedWallet: IWallet, origin: string, _transport: unknown, params: any) => {
      expect(receivedWallet).toBe(wallet)
      expect(await receivedWallet.getAddress()).toBe(vaultAddress)
      expect(await receivedWallet.getContractManager()).toBe(contracts)
      expect(origin).toBe('https://arkade.computer')
      expect(params.invoice.amountSats).toBe(2100)
      expect(params.rfqId).toBe(result.rfqId)
      return result
    })

    const quote = await requestVaultLightningQuote({
      wallet,
      arkServerUrl: 'https://arkade.computer',
      invoice: MAINNET_INVOICE,
      network: 'bitcoin',
      transport: {} as never,
      repository,
      contracts,
      manager,
      rfqId: result.rfqId,
      requester: requester as never,
      nowSeconds: INVOICE_TIMESTAMP + 1,
      enabled: true,
    })
    expect(quote).toMatchObject({
      invoiceAmountSats: 2100,
      fundAmountSats: 2125,
      corridorFeeSats: 25,
    })
    const record = await getVaultLightningStatus(repository, result.rfqId)
    expect(record).toMatchObject({
      rfqId: result.rfqId,
      kind: 'lightning_send',
      lockupAddress: result.address,
      amount: 2125,
      profile: {
        signer: { signingDescriptor: result.secrets.descriptor },
        hashlock: { paymentHash: result.treeParams.paymentHash },
      },
    })
    expect(record?.profile.vaultLightning).toEqual({
      version: 1,
      invoice: MAINNET_INVOICE,
      quote: result.quote,
      fundingState: 'quoted',
    })
    expect(await manager.hasSwap(result.rfqId)).toBe(true)
    await manager.stop()
    await repository[Symbol.asyncDispose]()
  })

  it('uses the published package to derive, verify, and register the VHTLC before returning it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime((INVOICE_TIMESTAMP + 1) * 1000)
    const phone = SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0')))
    const operator = SingleKey.fromPrivateKey(hex.decode('04'.padStart(64, '0')))
    const solver = SingleKey.fromPrivateKey(hex.decode('05'.padStart(64, '0')))
    const receiver = SingleKey.fromPrivateKey(hex.decode('06'.padStart(64, '0')))
    const operatorPub = (await operator.compressedPublicKey()).slice(1)
    const solverPub = (await solver.compressedPublicKey()).slice(1)
    const receiverPub = (await receiver.compressedPublicKey()).slice(1)
    const receiverScript = new DefaultVtxo.Script({
      pubKey: receiverPub,
      serverPubKey: operatorPub,
      csvTimelock: DefaultVtxo.Script.DEFAULT_TIMELOCK,
    }).pkScript
    const vaultAddress = await refundAddress()
    const { contracts, createContract } = memoryContracts()
    const repository = new InMemoryAssetSwapRepository()
    const { manager } = quoteManager(repository, contracts)
    const wallet = withVaultRefundAddress(
      {
        identity: phone,
        getAddress: async () => 'ark1wrong',
        getContractManager: async () => contracts,
      } as unknown as IWallet,
      vaultAddress,
    )
    const info = {
      version: 'v0.9.16-rc.11',
      signerPubkey: hex.encode(await operator.compressedPublicKey()),
      forfeitPubkey: hex.encode(await operator.compressedPublicKey()),
      forfeitAddress: 'bc1qexample',
      checkpointTapscript: '20' + '00'.repeat(32) + 'ac',
      network: 'bitcoin',
      sessionDuration: '60',
      unilateralExitDelay: '605184',
      boardingExitDelay: '7776256',
      utxoMinAmount: '330',
      utxoMaxAmount: '50000000',
      vtxoMinAmount: '330',
      vtxoMaxAmount: '50000000',
      dust: '330',
      fees: {
        intentFee: { offchainInput: '', offchainOutput: '', onchainInput: '', onchainOutput: '200.0' },
        txFeeRate: '0',
      },
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://arkade.computer/v1/info')
      return new Response(JSON.stringify(info), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const transport = {
      requestQuote: vi.fn(async (request: any): Promise<RfqQuote> => {
        const refundLocktime = INVOICE_TIMESTAMP + 10_000
        const script = lightningSendVtxoScript({
          solverPubkey: solverPub,
          refundLocktime,
          serverPubkey: operatorPub,
          paymentHash: 'da9fa986cf48f56ad387495f8e840ea9ed10889bf82f67c8a7b10d5d8a27886c',
          claimDelay: unilateralClaimDelay(Number(info.unilateralExitDelay)),
          emulatorPubkey: hex.decode(BITCOIN_EMULATOR_PUBKEY).slice(1),
          refundPkScript: ArkAddress.decode(vaultAddress).pkScript,
          senderPubkey: hex.decode(request.profile.client_refund_pubkey),
          receiverPkScript: receiverScript,
        })
        return {
          v: 1,
          type: 'rfq_quote',
          rfq_id: request.rfq_id,
          pair: 'arkade:BTC->lightning:BTC',
          amount_side: 'to',
          from_amount: 2125,
          to_amount: 2100,
          solver_pubkey: hex.encode(solverPub),
          valid_until: INVOICE_TIMESTAMP + 100,
          refund_locktime: refundLocktime,
          profile: {
            receiver_pk_script: hex.encode(receiverScript),
            lockup_address: script.address('ark', operatorPub).encode(),
          },
        }
      }),
      status: vi.fn(),
      close: vi.fn(),
    }

    const quote = await requestVaultLightningQuote({
      wallet,
      arkServerUrl: 'https://arkade.computer',
      invoice: MAINNET_INVOICE,
      network: 'bitcoin',
      transport,
      repository,
      contracts,
      manager,
      rfqId: 'ab'.repeat(32),
      nowSeconds: INVOICE_TIMESTAMP + 1,
      enabled: true,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(createContract).toHaveBeenCalledOnce()
    expect(createContract).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'vhtlc-v2',
        metadata: { genericallySpendable: false, kind: 'rfq-swap-lockup' },
      }),
    )
    const registered = createContract.mock.calls[0][0]
    const rebuilt = VHTLCV2ContractHandler.createScript(registered.params)
    expect(hex.encode(rebuilt.options.nonInteractiveRefund!.senderPkScript)).toBe(
      hex.encode(ArkAddress.decode(vaultAddress).pkScript),
    )
    const record = await repository.getRfqSwap(quote.rfqId)
    expect(registered.address).toBe(record?.lockupAddress)
    expect(registered.script).toBe(hex.encode(ArkAddress.decode(record!.lockupAddress).pkScript))
    await manager.stop()
    await repository[Symbol.asyncDispose]()
  })

  it('always closes the package Nostr transport', async () => {
    const transport = { close: vi.fn(async () => {}) } as unknown as import('@arkade-os/swap').RfqTransport
    await expect(
      withMainnetLightningTransport(
        async () => 'quoted',
        () => transport,
      ),
    ).resolves.toBe('quoted')
    expect(transport.close).toHaveBeenCalledOnce()

    const rejected = { close: vi.fn(async () => {}) } as unknown as import('@arkade-os/swap').RfqTransport
    await expect(
      withMainnetLightningTransport(
        async () => {
          throw new Error('solver unavailable')
        },
        () => rejected,
      ),
    ).rejects.toThrow(/solver unavailable/)
    expect(rejected.close).toHaveBeenCalledOnce()
  })

  it('fails closed on a changed refund destination, invalid funding amount, and elapsed quote', async () => {
    const vaultAddress = await refundAddress()
    const assertRejected = async (
      mutate: (
        result: Awaited<ReturnType<typeof completeRequestResult>>,
      ) => Awaited<ReturnType<typeof completeRequestResult>>,
      message: RegExp,
    ) => {
      const { contracts, rows } = memoryContracts()
      const repository = new InMemoryAssetSwapRepository()
      const { manager } = quoteManager(repository, contracts)
      const wallet = withVaultRefundAddress(
        {
          identity: SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0'))),
          getAddress: async () => 'ark1wrong',
          getContractManager: async () => contracts,
        } as unknown as IWallet,
        vaultAddress,
      )
      const base = await completeRequestResult(wallet, contracts)
      const result = mutate(base)
      await expect(
        requestVaultLightningQuote({
          wallet,
          arkServerUrl: 'https://arkade.computer',
          invoice: MAINNET_INVOICE,
          network: 'bitcoin',
          transport: {} as never,
          repository,
          contracts,
          manager,
          rfqId: base.rfqId,
          requester: vi.fn(async () => result) as never,
          nowSeconds: INVOICE_TIMESTAMP + 1,
          enabled: true,
        }),
      ).rejects.toThrow(message)
      expect(await repository.getRfqSwap(base.rfqId)).toBeUndefined()
      expect(rows.get(hex.encode(base.script.pkScript))?.watch).toBe('retained')
      await manager.stop()
      await repository[Symbol.asyncDispose]()
    }

    await assertRejected((base) => ({ ...base, refundAddress: 'ark1mutated' }), /refund address/)
    await assertRejected((base) => ({ ...base, fundAmount: 2099 }), /funding amount/)
    await assertRejected((base) => ({ ...base, swapPkScript: undefined as never }), /lockup script/)
    await assertRejected(
      (base) => ({ ...base, quote: { ...base.quote, valid_until: INVOICE_TIMESTAMP } }),
      /expired before Review/,
    )
  })

  it('does not contact a solver while the release gate is off', async () => {
    const requester = vi.fn()
    await expect(
      requestVaultLightningQuote({
        wallet: {} as IWallet,
        arkServerUrl: 'https://arkade.computer',
        invoice: MAINNET_INVOICE,
        network: 'bitcoin',
        transport: {} as never,
        repository: {} as InMemoryAssetSwapRepository,
        contracts: {} as SwapContractRegistry,
        manager: {} as RfqSwapManager,
        requester: requester as never,
        nowSeconds: INVOICE_TIMESTAMP + 1,
        enabled: false,
      }),
    ).rejects.toThrow(/not enabled/)
    expect(requester).not.toHaveBeenCalled()
  })
})

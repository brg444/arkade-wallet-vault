import {
  ArkAddress,
  BITCOIN_EMULATOR_PUBKEY,
  DefaultVtxo,
  SingleKey,
  VHTLCV2ContractHandler,
  provisionRefundKey,
  type Contract,
  type CreateContractParams,
  type IWallet,
} from '@arkade-os/sdk'
import {
  InMemoryAssetSwapRepository,
  RfqSwapManager,
  lightningSendVtxoScript,
  registerLockupContract,
  unilateralClaimDelay,
  type RfqQuote,
  type SwapContractRegistry,
} from '@arkade-os/swap'
import { hex } from '@scure/base'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginVaultLightningFunding,
  cancelVaultLightningQuote,
  assertVaultLightningQuoteCurrent,
  decodeVaultLightningInvoice,
  getVaultLightningStatus,
  recordVaultLightningFundingTxid,
  requestVaultLightningQuote,
  retireAbandonedVaultLightningQuotes,
  startVaultLightningLifecycle,
  validateVaultLightningRefund,
  vaultLightningSendEnabled,
  wholeSatsFromMillisats,
  withMainnetLightningTransport,
  withVaultRefundAddress,
  type VaultLightningQuote,
} from './lightning'

const MAINNET_INVOICE =
  'lnbc21u1pnk8larsp526g88ejh9ac0es9j6juxwenzdzvs6hcrphna5pp3jefpukmtk3hqpp5m206npk0fr6k45u8f90capqw48k3pzymlqhk0j98kyx4mz383pkqdz9235x2gr3w45kx6eqvfex7amwypnx77pqdf6k6urnyphhvetjyp6xsefqd3sh57fqv3hkwxqyp2xqcqz95rzjqv9ruzr6quwpsuwmyshlvenk0xm7djrtt8ugt2ja6cx3dkqtccdgvzzxeyqq28qqqqqqqqqqqqqqq9gq2y9qyysgqvu5k5w9q0xe62envhds058r9h8v5uak09hn3uzlw39sqkcuwh34j44gc53j6x6sg0u6yf6l0durxqqekytupxpf66zc7rc9cpav72ssqpcgv3p'

const INVOICE_TIMESTAMP = 1_734_606_755
const INVOICE_EXPIRES = INVOICE_TIMESTAMP + 43_200

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function refundAddress() {
  const phone = SingleKey.fromPrivateKey(hex.decode('01'.padStart(64, '0')))
  const operator = SingleKey.fromPrivateKey(hex.decode('04'.padStart(64, '0')))
  const phonePub = (await phone.compressedPublicKey()).slice(1)
  const operatorPub = (await operator.compressedPublicKey()).slice(1)
  const script = new DefaultVtxo.Script({
    pubKey: phonePub,
    serverPubKey: operatorPub,
    csvTimelock: DefaultVtxo.Script.DEFAULT_TIMELOCK,
  })
  return script.address('ark', operatorPub).encode()
}

function memoryContracts() {
  const rows = new Map<string, Contract>()
  const createContract = vi.fn(async (params: CreateContractParams) => {
    const existing = rows.get(params.script)
    if (existing) return existing
    const contract = {
      ...params,
      state: params.state ?? 'active',
      createdAt: Date.now(),
      watch: 'watched',
    } as Contract
    rows.set(contract.script, contract)
    return contract
  })
  const contracts = {
    createContract,
    getContracts: vi.fn(async (filter?: { script?: string | string[] }) => {
      const scripts = filter?.script ? (Array.isArray(filter.script) ? filter.script : [filter.script]) : undefined
      return [...rows.values()].filter((contract) => !scripts || scripts.includes(contract.script))
    }),
    onContractEvent: vi.fn(() => () => {}),
    setContractWatchState: vi.fn(async (script: string, watch: 'watched' | 'retained' | 'awaiting-funds') => {
      const contract = rows.get(script)
      if (!contract) throw new Error(`missing contract ${script}`)
      rows.set(script, { ...contract, watch } as Contract)
    }),
  } as unknown as SwapContractRegistry
  return { contracts, rows, createContract }
}

function emptyIndexer() {
  return {
    getVtxos: vi.fn(async () => ({ vtxos: [] })),
    getVirtualTxs: vi.fn(async () => ({ txs: [] })),
  }
}

function quoteManager(
  repository: InMemoryAssetSwapRepository,
  contracts: SwapContractRegistry,
  indexer = emptyIndexer(),
) {
  const manager = new RfqSwapManager({
    repository,
    contracts,
    indexer: indexer as never,
  })
  manager.setCallbacks({ refundArkade: vi.fn(async () => null) })
  return { manager, indexer }
}

async function completeRequestResult(
  wallet: IWallet,
  contracts: SwapContractRegistry,
  overrides: { fundAmount?: number; validUntil?: number; refundAddress?: string; rfqId?: string } = {},
) {
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
  const secrets = await provisionRefundKey(wallet)
  const refund = overrides.refundAddress ?? (await wallet.getAddress())
  const treeParams = {
    solverPubkey: solverPub,
    refundLocktime: INVOICE_TIMESTAMP + 10_000,
    serverPubkey: operatorPub,
    paymentHash: 'da9fa986cf48f56ad387495f8e840ea9ed10889bf82f67c8a7b10d5d8a27886c',
    claimDelay: unilateralClaimDelay(605_184),
    emulatorPubkey: hex.decode(BITCOIN_EMULATOR_PUBKEY).slice(1),
    refundPkScript: ArkAddress.decode(refund).pkScript,
    senderPubkey: secrets.pubkey,
    receiverPkScript: receiverScript,
  }
  const script = lightningSendVtxoScript(treeParams)
  const address = script.address('ark', operatorPub).encode()
  await registerLockupContract(contracts, script, address)
  const rfqId = overrides.rfqId ?? 'ab'.repeat(32)
  const quote: RfqQuote = {
    v: 1,
    type: 'rfq_quote',
    rfq_id: rfqId,
    pair: 'arkade:BTC->lightning:BTC',
    amount_side: 'to',
    from_amount: overrides.fundAmount ?? 2125,
    to_amount: 2100,
    solver_pubkey: hex.encode(solverPub),
    valid_until: overrides.validUntil ?? INVOICE_TIMESTAMP + 100,
    refund_locktime: treeParams.refundLocktime,
    profile: { receiver_pk_script: hex.encode(receiverScript), lockup_address: address },
  }
  return {
    rfqId,
    quote,
    address,
    fundAmount: overrides.fundAmount ?? 2125,
    swapPkScript: script.pkScript,
    script,
    refundAddress: refund,
    senderPubkey: secrets.pubkey,
    secrets,
    treeParams,
  }
}

async function lightningQuoteHarness(options: { validUntil?: number; rfqId?: string } = {}) {
  const vaultAddress = await refundAddress()
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
  const result = await completeRequestResult(wallet, contracts, options)
  const requester = vi.fn(async () => result)
  const request = () =>
    requestVaultLightningQuote({
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
  return { wallet, repository, contracts, rows, manager, result, requester, request }
}

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
        vaultLightning: {
          invoice: MAINNET_INVOICE,
          refundAddress: vaultAddress,
          swapPkScript: hex.encode(result.swapPkScript),
          senderPubkey: hex.encode(result.senderPubkey),
          fundingState: 'quoted',
        },
      },
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
    expect(registered.script).toBe((record?.profile.vaultLightning as { swapPkScript: string }).swapPkScript)
    expect((record?.profile.vaultLightning as { refundAddress: string }).refundAddress).toBe(vaultAddress)
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
      const { contracts } = memoryContracts()
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
      await manager.stop()
      await repository[Symbol.asyncDispose]()
    }

    await assertRejected((base) => ({ ...base, refundAddress: 'ark1mutated' }), /refund address/)
    await assertRejected((base) => ({ ...base, fundAmount: 2099 }), /funding amount/)
    await assertRejected(
      (base) => ({ ...base, quote: { ...base.quote, valid_until: INVOICE_TIMESTAMP } }),
      /expired before Review/,
    )
  })

  it('persists complete recovery state before exposing a quote and resumes a dropped response idempotently', async () => {
    const harness = await lightningQuoteHarness()
    const first = await harness.request()
    const stored = await harness.repository.getRfqSwap(first.rfqId)
    expect(stored).toMatchObject({
      state: 'pending',
      profile: {
        signer: { signingDescriptor: expect.any(String) },
        hashlock: { paymentHash: harness.result.treeParams.paymentHash },
        vaultLightning: {
          quote: harness.result.quote,
          senderPubkey: hex.encode(harness.result.senderPubkey),
          swapPkScript: hex.encode(harness.result.swapPkScript),
        },
      },
    })

    await expect(harness.request()).resolves.toEqual(first)
    expect(harness.requester).toHaveBeenCalledOnce()

    const target = await beginVaultLightningFunding(harness.repository, first.rfqId, INVOICE_TIMESTAMP + 2)
    await expect(beginVaultLightningFunding(harness.repository, first.rfqId, INVOICE_TIMESTAMP + 2)).resolves.toEqual(
      target,
    )
    expect(target).toEqual({ rfqId: first.rfqId, address: harness.result.address, amountSats: 2125 })
    const txid = 'cd'.repeat(32)
    await recordVaultLightningFundingTxid(harness.repository, first.rfqId, txid)
    await recordVaultLightningFundingTxid(harness.repository, first.rfqId, txid)
    await expect(recordVaultLightningFundingTxid(harness.repository, first.rfqId, 'ef'.repeat(32))).rejects.toThrow(
      /another funding transaction/,
    )
    expect(await harness.repository.getRfqSwap(first.rfqId)).toMatchObject({ fundingArkTxid: txid })

    await harness.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('withholds a quote and retires its registered contract when durable persistence fails', async () => {
    const vaultAddress = await refundAddress()
    const { contracts, rows } = memoryContracts()
    const backing = new InMemoryAssetSwapRepository()
    const saveRfqSwap = vi.fn(async () => {
      throw new Error('IndexedDB unavailable')
    })
    const repository = new Proxy(backing, {
      get(target, property, receiver) {
        if (property === 'saveRfqSwap') return saveRfqSwap
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const { manager } = quoteManager(repository, contracts)
    const wallet = withVaultRefundAddress(
      {
        identity: SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0'))),
        getAddress: async () => 'ark1wrong',
        getContractManager: async () => contracts,
      } as unknown as IWallet,
      vaultAddress,
    )
    const result = await completeRequestResult(wallet, contracts)

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
        rfqId: result.rfqId,
        requester: vi.fn(async () => result) as never,
        nowSeconds: INVOICE_TIMESTAMP + 1,
        enabled: true,
      }),
    ).rejects.toThrow(/IndexedDB unavailable/)
    expect(saveRfqSwap).toHaveBeenCalledOnce()
    expect(rows.get(hex.encode(result.swapPkScript))?.watch).toBe('retained')
    expect(await backing.getRfqSwap(result.rfqId)).toBeUndefined()

    await manager.stop()
    await backing[Symbol.asyncDispose]()
  })

  it('cancels an unfunded quote and retires expired abandoned records without leaking contract watches', async () => {
    const cancelled = await lightningQuoteHarness()
    const quote = await cancelled.request()
    await expect(cancelVaultLightningQuote(cancelled, quote.rfqId)).resolves.toBe(true)
    expect(await cancelled.repository.getRfqSwap(quote.rfqId)).toBeUndefined()
    expect(cancelled.rows.get(hex.encode(cancelled.result.swapPkScript))?.watch).toBe('retained')
    await expect(cancelVaultLightningQuote(cancelled, quote.rfqId)).resolves.toBe(false)
    await cancelled.manager.stop()
    await cancelled.repository[Symbol.asyncDispose]()

    const expired = await lightningQuoteHarness()
    const late = await expired.request()
    const retired = await retireAbandonedVaultLightningQuotes(expired.repository, expired.contracts, late.validUntil)
    expect(retired).toEqual({ retired: [late.rfqId], failed: [] })
    expect(await expired.repository.getRfqSwap(late.rfqId)).toBeUndefined()
    expect(expired.rows.get(hex.encode(expired.result.swapPkScript))?.watch).toBe('retained')
    await expired.manager.stop()
    await expired.repository[Symbol.asyncDispose]()
  })

  it('restores a persisted package RFQ record after restart', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await harness.manager.stop()
    const indexer = emptyIndexer()
    const lifecycle = await startVaultLightningLifecycle({
      wallet: harness.wallet,
      ark: {} as never,
      indexer: indexer as never,
      repository: harness.repository,
      managerConfig: {
        enableAutoActions: false,
        pollIntervalMs: 60_000,
        now: () => INVOICE_TIMESTAMP + 2,
      },
      refundArkade: vi.fn(async () => null),
    })

    expect(lifecycle.restoreFailures).toEqual([])
    expect(lifecycle.retiredQuoteIds).toEqual([])
    expect(await lifecycle.manager.hasSwap(quote.rfqId)).toBe(true)
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({ state: 'pending' })

    await lifecycle.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('uses the package manager refund lifecycle for a funded quote that resumes after its refund time', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, INVOICE_TIMESTAMP + 2)
    await harness.manager.stop()
    const refundArkade = vi.fn(async () => ({ arkTxid: 'cd'.repeat(32), amount: quote.fundAmountSats }))
    const lifecycle = await startVaultLightningLifecycle({
      wallet: harness.wallet,
      ark: {} as never,
      indexer: emptyIndexer() as never,
      repository: harness.repository,
      managerConfig: {
        pollIntervalMs: 60_000,
        now: () => quote.refundLocktime,
      },
      refundArkade,
    })

    expect(refundArkade).toHaveBeenCalledOnce()
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({
      state: 'refunded',
      refundArkTxid: 'cd'.repeat(32),
    })
    expect(harness.rows.get(hex.encode(harness.result.swapPkScript))?.watch).toBe('retained')

    await lifecycle.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
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

  it('rechecks quote and invoice expiry immediately before funding', () => {
    const quote = {
      invoiceExpiresAt: 200,
      validUntil: 100,
    } as VaultLightningQuote
    expect(() => assertVaultLightningQuoteCurrent(quote, 99)).not.toThrow()
    expect(() => assertVaultLightningQuoteCurrent(quote, 100)).toThrow(/quote has expired/)
    expect(() => assertVaultLightningQuoteCurrent({ ...quote, validUntil: 300 }, 200)).toThrow(/invoice has expired/)
  })
})

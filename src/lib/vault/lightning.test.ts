import {
  ArkAddress,
  BITCOIN_EMULATOR_PUBKEY,
  DefaultVtxo,
  SingleKey,
  VHTLCV2ContractHandler,
  type IWallet,
} from '@arkade-os/sdk'
import { lightningSendVtxoScript, unilateralClaimDelay, type RfqQuote } from '@arkade-os/swap'
import { hex } from '@scure/base'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertVaultLightningQuoteCurrent,
  decodeVaultLightningInvoice,
  requestVaultLightningQuote,
  validateVaultLightningRefund,
  vaultLightningSendEnabled,
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
    const contracts = { marker: 'stock-contract-manager' }
    const wallet = withVaultRefundAddress(
      {
        identity,
        getAddress: async () => 'ark1wrong',
        getContractManager: async () => contracts,
      } as unknown as IWallet,
      vaultAddress,
    )
    const requester = vi.fn(async (receivedWallet: IWallet, origin: string, _transport: unknown, params: any) => {
      expect(receivedWallet).toBe(wallet)
      expect(await receivedWallet.getAddress()).toBe(vaultAddress)
      expect(await receivedWallet.getContractManager()).toBe(contracts)
      expect(origin).toBe('https://arkade.computer')
      expect(params.invoice.amountSats).toBe(2100)
      return {
        rfqId: 'ab'.repeat(32),
        quote: {
          valid_until: INVOICE_TIMESTAMP + 100,
          refund_locktime: INVOICE_TIMESTAMP + 10_000,
        },
        address: 'ark1packageverifiedlockup',
        fundAmount: 2125,
        swapPkScript: new Uint8Array([0x51, 0x20]),
        refundAddress: vaultAddress,
      }
    })

    const quote = await requestVaultLightningQuote({
      wallet,
      arkServerUrl: 'https://arkade.computer',
      invoice: MAINNET_INVOICE,
      network: 'bitcoin',
      transport: {} as never,
      requester: requester as never,
      nowSeconds: INVOICE_TIMESTAMP + 1,
      enabled: true,
    })
    expect(quote).toMatchObject({
      invoiceAmountSats: 2100,
      fundAmountSats: 2125,
      corridorFeeSats: 25,
      refundAddress: vaultAddress,
      swapPkScript: '5120',
    })
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
    const createContract = vi.fn(async (contract) => contract)
    const wallet = withVaultRefundAddress(
      {
        identity: phone,
        getAddress: async () => 'ark1wrong',
        getContractManager: async () => ({ createContract }),
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
      nowSeconds: INVOICE_TIMESTAMP + 1,
      enabled: true,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(createContract).toHaveBeenCalledOnce()
    expect(createContract).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'vhtlc-v2',
        address: quote.lockupAddress,
        script: quote.swapPkScript,
        metadata: { genericallySpendable: false, kind: 'rfq-swap-lockup' },
      }),
    )
    const registered = createContract.mock.calls[0][0]
    const rebuilt = VHTLCV2ContractHandler.createScript(registered.params)
    expect(hex.encode(rebuilt.options.nonInteractiveRefund!.senderPkScript)).toBe(
      hex.encode(ArkAddress.decode(vaultAddress).pkScript),
    )
    expect(quote.refundAddress).toBe(vaultAddress)
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
    const wallet = withVaultRefundAddress(
      {
        identity: SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0'))),
        getAddress: async () => 'ark1wrong',
      } as unknown as IWallet,
      vaultAddress,
    )
    const base = {
      rfqId: 'ab'.repeat(32),
      quote: { valid_until: INVOICE_TIMESTAMP + 100, refund_locktime: INVOICE_TIMESTAMP + 10_000 },
      address: 'ark1packageverifiedlockup',
      fundAmount: 2125,
      swapPkScript: new Uint8Array([0x51, 0x20]),
      refundAddress: vaultAddress,
    }
    const request = (result: typeof base) =>
      requestVaultLightningQuote({
        wallet,
        arkServerUrl: 'https://arkade.computer',
        invoice: MAINNET_INVOICE,
        network: 'bitcoin',
        transport: {} as never,
        requester: vi.fn(async () => result) as never,
        nowSeconds: INVOICE_TIMESTAMP + 1,
        enabled: true,
      })

    await expect(request({ ...base, refundAddress: 'ark1mutated' })).rejects.toThrow(/refund address/)
    await expect(request({ ...base, fundAmount: 2099 })).rejects.toThrow(/funding amount/)
    await expect(request({ ...base, quote: { ...base.quote, valid_until: INVOICE_TIMESTAMP } })).rejects.toThrow(
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

import { SingleKey, type IWallet } from '@arkade-os/sdk'
import { InMemoryAssetSwapRepository } from '@arkade-os/swap'
import { hex } from '@scure/base'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertVaultLightningQuoteCurrent,
  beginVaultLightningFunding,
  cancelVaultLightningQuote,
  listVaultLightningHistory,
  recordVaultLightningFundingTxid,
  requestVaultLightningQuote,
  retireAbandonedVaultLightningQuotes,
  startVaultLightningLifecycle,
  withVaultRefundAddress,
  type VaultLightningQuote,
} from './lightning'
import {
  INVOICE_TIMESTAMP,
  MAINNET_INVOICE,
  MAINNET_TEST_PROFILE,
  completeRequestResult,
  emptyIndexer,
  lightningQuoteHarness,
  memoryContracts,
  quoteManager,
  refundAddress,
} from './lightningTestUtils'

afterEach(() => vi.useRealTimers())

describe('Lightning persisted lifecycle', () => {
  it('persists complete recovery state before exposing a quote and resumes a dropped response idempotently', async () => {
    const harness = await lightningQuoteHarness()
    const first = await harness.request()
    const stored = await harness.repository.getRfqSwap(first.rfqId)
    expect(stored).toMatchObject({
      state: 'pending',
      profile: {
        signer: { signingDescriptor: expect.any(String) },
        hashlock: { paymentHash: harness.result.treeParams.paymentHash },
        vaultLightning: { quote: harness.result.quote },
      },
    })
    expect(stored?.profile.vaultLightning).toEqual({
      version: 2,
      network: 'bitcoin',
      invoice: MAINNET_INVOICE,
      quote: harness.result.quote,
      fundingState: 'quoted',
    })

    await expect(harness.request()).resolves.toEqual(first)
    expect(harness.requester).toHaveBeenCalledOnce()

    await expect(
      requestVaultLightningQuote({
        wallet: harness.wallet,
        arkServerUrl: 'https://arkade.computer',
        invoice: MAINNET_INVOICE,
        network: 'bitcoin',
        transport: {} as never,
        repository: harness.repository,
        contracts: harness.contracts,
        manager: harness.manager,
        profile: MAINNET_TEST_PROFILE,
        requester: harness.requester as never,
        nowSeconds: INVOICE_TIMESTAMP + 1,
        enabled: true,
      }),
    ).resolves.toEqual(first)
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
    await expect(listVaultLightningHistory(harness.repository)).resolves.toEqual([
      { txid, invoiceAmountSats: 2100, state: 'pending' },
    ])

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
        profile: MAINNET_TEST_PROFILE,
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
    const lifecycle = await startVaultLightningLifecycle({
      wallet: harness.wallet,
      ark: {} as never,
      indexer: emptyIndexer() as never,
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

  it('rechecks quote and invoice expiry immediately before funding', () => {
    const quote = { invoiceExpiresAt: 200, validUntil: 100 } as VaultLightningQuote
    expect(() => assertVaultLightningQuoteCurrent(quote, 99)).not.toThrow()
    expect(() => assertVaultLightningQuoteCurrent(quote, 100)).toThrow(/quote has expired/)
    expect(() => assertVaultLightningQuoteCurrent({ ...quote, validUntil: 300 }, 200)).toThrow(/invoice has expired/)
  })
})

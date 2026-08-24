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
  refreshVaultLightningLifecycle,
  requestVaultLightningQuote,
  retireAbandonedVaultLightningQuotes,
  startVaultLightningLifecycle,
  vaultLightningLifecycleErrors,
  withVaultLightningLifecycleLock,
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
import type { VaultLockManager } from './vtxo/lock'

class DeterministicLockManager implements VaultLockManager {
  private readonly held = new Set<string>()
  private readonly waiters = new Map<string, (() => void)[]>()

  async request<T>(
    name: string,
    _options: { mode: 'exclusive'; ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T> {
    while (this.held.has(name)) {
      await new Promise<void>((resolve) => {
        const waiters = this.waiters.get(name) || []
        waiters.push(resolve)
        this.waiters.set(name, waiters)
      })
    }
    this.held.add(name)
    try {
      return await callback({ name })
    } finally {
      this.held.delete(name)
      this.waiters.get(name)?.shift()?.()
    }
  }
}

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
      { rfqId: first.rfqId, txid, invoiceAmountSats: 2100, state: 'pending' },
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

  it('recovers a lost funding response from package activity inputs', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, INVOICE_TIMESTAMP + 2)
    const txid = 'cd'.repeat(32)
    const indexer = {
      getVtxos: vi.fn(async () => ({ vtxos: [{ txid, vout: 0, value: quote.fundAmountSats }] })),
      getVirtualTxs: vi.fn(async () => ({ txs: [] })),
    }

    await expect(listVaultLightningHistory(harness.repository, indexer as never)).resolves.toEqual([
      { rfqId: quote.rfqId, txid, invoiceAmountSats: 2100, state: 'pending' },
    ])

    await harness.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('keeps valid history visible when another RFQ profile is malformed', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, INVOICE_TIMESTAMP + 2)
    await recordVaultLightningFundingTxid(harness.repository, quote.rfqId, 'ab'.repeat(32))
    const record = await harness.repository.getRfqSwap(quote.rfqId)
    expect(record).toBeDefined()
    const validRfqId = 'ef'.repeat(32)
    await harness.repository.saveRfqSwap({
      ...record!,
      rfqId: validRfqId,
      fundingArkTxid: 'cd'.repeat(32),
      profile: {
        ...record!.profile,
        vaultLightning: {
          ...(record!.profile.vaultLightning as Record<string, unknown>),
          quote: {
            ...((record!.profile.vaultLightning as { quote: Record<string, unknown> }).quote || {}),
            rfq_id: validRfqId,
          },
        },
      },
    })
    await harness.repository.saveRfqSwap({
      ...record!,
      profile: { ...record!.profile, vaultLightning: { version: 2 } },
    })

    await expect(listVaultLightningHistory(harness.repository)).resolves.toEqual([
      { rfqId: validRfqId, txid: 'cd'.repeat(32), invoiceAmountSats: 2100, state: 'pending' },
    ])

    await harness.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('marks a refund due after reload without retaining a signing key', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, INVOICE_TIMESTAMP + 2)
    await harness.manager.stop()

    const refreshed = await refreshVaultLightningLifecycle({
      repository: harness.repository,
      contracts: harness.contracts,
      indexer: emptyIndexer() as never,
      managerConfig: {
        pollIntervalMs: 60_000,
        now: () => quote.refundLocktime,
      },
    })

    expect(refreshed.restoreFailures).toEqual([])
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({ state: 'needs_counterparty' })

    await harness.repository[Symbol.asyncDispose]()
  })

  it('serializes two managers so a delayed keyless pass cannot regress a terminal refund', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, INVOICE_TIMESTAMP + 2)
    await harness.manager.stop()
    const locks = new DeterministicLockManager()
    let announceRead!: () => void
    const readStarted = new Promise<void>((resolve) => {
      announceRead = resolve
    })
    let releaseRead!: () => void
    const readRelease = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let firstRead = true
    const delayedIndexer = {
      getVtxos: vi.fn(async () => {
        if (firstRead) {
          firstRead = false
          announceRead()
          await readRelease
        }
        return { vtxos: [] }
      }),
      getVirtualTxs: vi.fn(async () => ({ txs: [] })),
    }
    const keyless = withVaultLightningLifecycleLock(
      'vault-lightning',
      () =>
        refreshVaultLightningLifecycle({
          repository: harness.repository,
          contracts: harness.contracts,
          indexer: delayedIndexer as never,
          managerConfig: { pollIntervalMs: 60_000, now: () => quote.refundLocktime },
        }),
      locks,
    )
    await readStarted

    const refundArkade = vi.fn(async () => ({ arkTxid: 'cd'.repeat(32), amount: quote.fundAmountSats }))
    const signing = withVaultLightningLifecycleLock(
      'vault-lightning',
      async () => {
        const lifecycle = await startVaultLightningLifecycle({
          wallet: harness.wallet,
          ark: {} as never,
          indexer: emptyIndexer() as never,
          repository: harness.repository,
          managerConfig: { pollIntervalMs: 60_000, now: () => quote.refundLocktime },
          refundArkade,
        })
        await lifecycle.manager.stop()
      },
      locks,
    )
    await Promise.resolve()
    expect(refundArkade).not.toHaveBeenCalled()

    releaseRead()
    await Promise.all([keyless, signing])
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({
      state: 'refunded',
      refundArkTxid: 'cd'.repeat(32),
    })
    expect(refundArkade).toHaveBeenCalledOnce()

    await harness.repository[Symbol.asyncDispose]()
  })

  it('isolates a missing contract while preserving valid history and targeted recovery', async () => {
    const harness = await lightningQuoteHarness()
    const missing = await harness.request()
    const validWallet = withVaultRefundAddress(
      {
        identity: SingleKey.fromPrivateKey(hex.decode('03'.padStart(64, '0'))),
        getAddress: async () => 'ark1wrong',
        getContractManager: async () => harness.contracts,
      } as unknown as IWallet,
      await refundAddress(),
    )
    const validResult = await completeRequestResult(validWallet, harness.contracts, { rfqId: 'ef'.repeat(32) })
    const valid = await requestVaultLightningQuote({
      wallet: validWallet,
      arkServerUrl: 'https://arkade.computer',
      invoice: MAINNET_INVOICE,
      network: 'bitcoin',
      transport: {} as never,
      repository: harness.repository,
      contracts: harness.contracts,
      manager: harness.manager,
      profile: MAINNET_TEST_PROFILE,
      rfqId: validResult.rfqId,
      requester: vi.fn(async () => validResult) as never,
      nowSeconds: INVOICE_TIMESTAMP + 1,
      enabled: true,
    })
    await beginVaultLightningFunding(harness.repository, missing.rfqId, INVOICE_TIMESTAMP + 2)
    await beginVaultLightningFunding(harness.repository, valid.rfqId, INVOICE_TIMESTAMP + 2)
    await recordVaultLightningFundingTxid(harness.repository, missing.rfqId, 'ab'.repeat(32))
    await recordVaultLightningFundingTxid(harness.repository, valid.rfqId, 'cd'.repeat(32))
    await harness.manager.stop()
    harness.rows.delete(hex.encode(harness.result.swapPkScript))

    const refreshed = await refreshVaultLightningLifecycle({
      repository: harness.repository,
      contracts: harness.contracts,
      indexer: emptyIndexer() as never,
      managerConfig: { pollIntervalMs: 60_000, now: () => INVOICE_TIMESTAMP + 2 },
    })

    expect(refreshed.restoreFailures).toEqual([
      expect.objectContaining({
        rfqId: missing.rfqId,
        error: expect.objectContaining({ name: 'LockupContractMissing' }),
      }),
    ])
    expect(refreshed.history).toEqual([
      { rfqId: valid.rfqId, txid: 'cd'.repeat(32), invoiceAmountSats: 2100, state: 'pending' },
    ])
    const lifecycleFailures = { restoreFailures: refreshed.restoreFailures, retirementFailures: [] }
    expect(vaultLightningLifecycleErrors(lifecycleFailures, valid.rfqId)).toEqual([])
    expect(vaultLightningLifecycleErrors(lifecycleFailures, missing.rfqId)).toEqual([
      expect.objectContaining({ name: 'LockupContractMissing' }),
    ])

    const refundArkade = vi.fn(async (swap: { rfqId: string }) => {
      expect(swap.rfqId).toBe(valid.rfqId)
      return { arkTxid: 'de'.repeat(32), amount: valid.fundAmountSats }
    })
    const targeted = await startVaultLightningLifecycle({
      wallet: validWallet,
      ark: {} as never,
      indexer: emptyIndexer() as never,
      repository: harness.repository,
      managerConfig: { pollIntervalMs: 60_000, now: () => valid.refundLocktime },
      refundArkade: refundArkade as never,
      requiredRfqId: valid.rfqId,
    })
    expect(targeted.restoreFailures).toEqual([])
    expect(refundArkade).toHaveBeenCalledOnce()
    expect(await harness.repository.getRfqSwap(valid.rfqId)).toMatchObject({
      state: 'refunded',
      refundArkTxid: 'de'.repeat(32),
    })
    expect(await harness.repository.getRfqSwap(missing.rfqId)).toMatchObject({ state: 'pending' })
    await targeted.manager.stop()

    await harness.repository[Symbol.asyncDispose]()
  })

  it('fails closed when a fresh browser has the swap record but not its registered contract', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, INVOICE_TIMESTAMP + 2)
    await harness.manager.stop()
    const freshBrowserContracts = memoryContracts().contracts

    const refreshed = await refreshVaultLightningLifecycle({
      repository: harness.repository,
      contracts: freshBrowserContracts,
      indexer: emptyIndexer() as never,
      managerConfig: { pollIntervalMs: 60_000 },
    })

    expect(refreshed.restoreFailures).toEqual([
      expect.objectContaining({
        rfqId: quote.rfqId,
        error: expect.objectContaining({ name: 'LockupContractMissing' }),
      }),
    ])
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toBeDefined()

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

import { SingleKey } from '@arkade-os/sdk'
import { InMemoryAssetSwapRepository, RefundNotLocallyPossibleError, type RfqSwapManager } from '@arkade-os/swap'
import { hex } from '@scure/base'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertVaultLightningQuoteCurrent,
  beginVaultLightningFunding,
  cancelVaultLightningQuote,
  recordVaultLightningFundingTxid,
  resumeVaultLightningFunding,
  requestVaultLightningQuote,
  retireAbandonedVaultLightningQuotes,
  vaultLightningRequestWallet,
  type VaultLightningQuote,
} from './lightning'
import {
  createVaultLightningObserver,
  listVaultLightningActivityRecords,
  maintainVaultLightningObserver,
  reconcileVaultLightningFundingTxids,
  withAuthenticatedVaultLightningRefund,
} from './lightningLifecycle'
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

async function startTestObserver(deps: Parameters<typeof createVaultLightningObserver>[0]) {
  const manager = createVaultLightningObserver(deps)
  return {
    manager,
    ...(await maintainVaultLightningObserver({
      manager,
      contracts: deps.contracts,
      indexer: deps.indexer,
      repository: deps.repository,
      nowSeconds: deps.managerConfig?.now?.(),
    })),
  }
}

describe('Lightning persisted lifecycle', () => {
  const fundingProof = (quote: VaultLightningQuote) => ({
    rfqId: quote.rfqId,
    address: quote.fundAddress,
    amountSats: quote.fundAmountSats,
    operationId: '11111111-1111-4111-8111-111111111111',
    bundleDigest: 'aa'.repeat(32),
    fundingFeeSats: 25,
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

    const target = await beginVaultLightningFunding(
      harness.repository,
      first.rfqId,
      fundingProof(first),
      INVOICE_TIMESTAMP + 2,
    )
    expect(target).toEqual({ rfqId: first.rfqId, address: harness.result.address, amountSats: 2125 })
    const proof = fundingProof(first)
    await expect(
      resumeVaultLightningFunding(
        harness.repository,
        {
          bundleDigest: proof.bundleDigest,
          operationId: proof.operationId,
          amountSats: proof.amountSats,
          address: proof.address,
          rfqId: proof.rfqId,
          fundingFeeSats: proof.fundingFeeSats,
        },
        INVOICE_TIMESTAMP + 2,
      ),
    ).resolves.toEqual(target)
    await expect(
      resumeVaultLightningFunding(
        harness.repository,
        { ...proof, operationId: '22222222-2222-4222-8222-222222222222' },
        INVOICE_TIMESTAMP + 2,
      ),
    ).rejects.toThrow(/does not match/)
    await expect(
      beginVaultLightningFunding(harness.repository, first.rfqId, fundingProof(first), INVOICE_TIMESTAMP + 2),
    ).rejects.toThrow(/already processing/)
    await expect(harness.request()).rejects.toThrow(/already processing/)
    expect(harness.requester).toHaveBeenCalledOnce()
    const txid = 'cd'.repeat(32)
    await recordVaultLightningFundingTxid(harness.repository, first.rfqId, txid)
    await recordVaultLightningFundingTxid(harness.repository, first.rfqId, txid)
    await expect(recordVaultLightningFundingTxid(harness.repository, first.rfqId, 'ef'.repeat(32))).rejects.toThrow(
      /another funding transaction/,
    )
    expect(await harness.repository.getRfqSwap(first.rfqId)).toMatchObject({ fundingArkTxid: txid })
    await expect(listVaultLightningActivityRecords(harness.repository)).resolves.toEqual([
      expect.objectContaining({ rfqId: first.rfqId, fundingTxid: txid, displayAmount: 2100, state: 'pending' }),
    ])

    await harness.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('does not bypass persisted funding when the rest of that swap record is damaged', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, fundingProof(quote), INVOICE_TIMESTAMP + 2)
    const record = await harness.repository.getRfqSwap(quote.rfqId)
    const profile = record!.profile.vaultLightning as { quote: { from_amount: number } }
    await harness.repository.saveRfqSwap({
      ...record!,
      profile: {
        ...record!.profile,
        vaultLightning: {
          ...profile,
          quote: { ...profile.quote, from_amount: profile.quote.from_amount + 1 },
        },
      },
    })
    const requester = vi.fn()

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
        requester: requester as never,
        nowSeconds: INVOICE_TIMESTAMP + 2,
        enabled: true,
      }),
    ).rejects.toThrow(/already processing/)
    expect(requester).not.toHaveBeenCalled()

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
    const wallet = vaultLightningRequestWallet(
      SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0'))),
      vaultAddress,
      contracts as never,
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

  it('removes an abandoned unfunded record even when its old contract is missing', async () => {
    const harness = await lightningQuoteHarness({ validUntil: INVOICE_TIMESTAMP + 2 })
    const quote = await harness.request()
    harness.rows.delete(hex.encode(harness.result.swapPkScript))

    const result = await retireAbandonedVaultLightningQuotes(
      harness.repository,
      harness.contracts,
      INVOICE_TIMESTAMP + 3,
    )
    expect(result.retired).toEqual([quote.rfqId])
    expect(result.failed).toEqual([{ rfqId: quote.rfqId, error: expect.any(Error) }])
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toBeUndefined()

    await harness.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('treats cancellation as complete when only best-effort contract retirement fails', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    harness.rows.delete(hex.encode(harness.result.swapPkScript))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(cancelVaultLightningQuote(harness, quote.rfqId)).resolves.toBe(true)
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toBeUndefined()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('contract retirement failed after cancellation'))

    consoleSpy.mockRestore()
    await harness.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('restores a persisted package RFQ record after restart', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await harness.manager.stop()
    const lifecycle = await startTestObserver({
      contracts: harness.contracts,
      indexer: emptyIndexer() as never,
      repository: harness.repository,
      managerConfig: {
        pollIntervalMs: 60_000,
        now: () => INVOICE_TIMESTAMP + 2,
      },
    })

    expect(lifecycle.restoreFailures).toEqual([])
    expect(lifecycle.retiredQuoteIds).toEqual([])
    expect(await lifecycle.manager.hasSwap(quote.rfqId)).toBe(true)
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({ state: 'pending' })

    await lifecycle.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('keeps one non-signing package observer alive on the persistent repository', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await harness.manager.stop()

    const observer = await startTestObserver({
      contracts: harness.contracts,
      indexer: emptyIndexer() as never,
      repository: harness.repository,
      managerConfig: { pollIntervalMs: 60_000, now: () => INVOICE_TIMESTAMP + 2 },
    })

    expect(observer.restoreFailures).toEqual([])
    expect(await observer.manager.hasSwap(quote.rfqId)).toBe(true)
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({ state: 'pending' })
    await expect(observer.manager.getStats()).resolves.toMatchObject({ isRunning: false, monitoredSwaps: 1 })

    await observer.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('rebuilds a stale second-tab manager from terminal durable state before polling', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, fundingProof(quote), INVOICE_TIMESTAMP + 2)
    await recordVaultLightningFundingTxid(harness.repository, quote.rfqId, 'ab'.repeat(32))
    await harness.manager.stop()

    const deps = {
      contracts: harness.contracts,
      indexer: emptyIndexer() as never,
      repository: harness.repository,
      managerConfig: { now: () => INVOICE_TIMESTAMP + 3 },
    }
    const tabA = createVaultLightningObserver(deps)
    const tabB = createVaultLightningObserver(deps)
    await maintainVaultLightningObserver({ manager: tabA, ...deps, nowSeconds: INVOICE_TIMESTAMP + 3 })
    await maintainVaultLightningObserver({ manager: tabB, ...deps, nowSeconds: INVOICE_TIMESTAMP + 3 })
    expect(await tabB.hasSwap(quote.rfqId)).toBe(true)

    const durable = await harness.repository.getRfqSwap(quote.rfqId)
    if (!durable) throw new Error('funded quote was not persisted')
    await harness.repository.saveRfqSwap({
      ...durable,
      state: 'settled',
      updatedAt: durable.updatedAt + 1,
      lockupSpendArkTxids: ['cd'.repeat(32)],
    })

    await maintainVaultLightningObserver({ manager: tabB, ...deps, nowSeconds: INVOICE_TIMESTAMP + 4 })
    expect(await tabB.hasSwap(quote.rfqId)).toBe(false)
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({
      state: 'settled',
      fundingArkTxid: 'ab'.repeat(32),
      lockupSpendArkTxids: ['cd'.repeat(32)],
    })

    await tabA.stop()
    await tabB.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('projects one valid funded package record for no-activity history synthesis', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, fundingProof(quote), INVOICE_TIMESTAMP + 2)
    const fundingTxid = 'de'.repeat(32)
    await recordVaultLightningFundingTxid(harness.repository, quote.rfqId, fundingTxid)

    await expect(listVaultLightningActivityRecords(harness.repository)).resolves.toEqual([
      {
        rfqId: quote.rfqId,
        fundingTxid,
        state: 'pending',
        amount: quote.fundAmountSats,
        displayAmount: quote.invoiceAmountSats,
        fee: quote.corridorFeeSats + 25,
        createdAt: INVOICE_TIMESTAMP + 1,
        terminal: false,
      },
    ])

    await harness.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('isolates one stale restore and retirement failure so a new quote can proceed', async () => {
    const harness = await lightningQuoteHarness({ validUntil: INVOICE_TIMESTAMP + 2 })
    const stale = await harness.request()
    const staleRecord = await harness.repository.getRfqSwap(stale.rfqId)
    expect(staleRecord).toBeDefined()
    await harness.repository.saveRfqSwap({ ...staleRecord!, lockupAddress: 'not-an-arkade-address' })
    const restoreRfqId = 'ef'.repeat(32)
    const storedProfile = staleRecord!.profile.vaultLightning as {
      quote: { rfq_id: string; valid_until: number }
    }
    await harness.repository.saveRfqSwap({
      ...staleRecord!,
      rfqId: restoreRfqId,
      lockupAddress: 'also-not-an-arkade-address',
      updatedAt: staleRecord!.updatedAt + 1,
      profile: {
        ...staleRecord!.profile,
        vaultLightning: {
          ...storedProfile,
          quote: {
            ...storedProfile.quote,
            rfq_id: restoreRfqId,
            valid_until: INVOICE_TIMESTAMP + 100,
          },
        },
      },
    })
    await harness.manager.stop()

    const lifecycle = await startTestObserver({
      contracts: harness.contracts,
      indexer: emptyIndexer() as never,
      repository: harness.repository,
      managerConfig: {
        pollIntervalMs: 60_000,
        now: () => INVOICE_TIMESTAMP + 3,
      },
    })
    expect(lifecycle.retirementFailures).toHaveLength(1)
    expect(lifecycle.restoreFailures).toHaveLength(1)
    expect(await harness.repository.getRfqSwap(stale.rfqId)).toBeUndefined()
    expect(await harness.repository.getRfqSwap(restoreRfqId)).toBeDefined()

    const replacement = await completeRequestResult(harness.wallet, harness.contracts, { rfqId: 'cd'.repeat(32) })
    const requester = vi.fn(async () => replacement)
    await expect(
      requestVaultLightningQuote({
        wallet: harness.wallet,
        arkServerUrl: 'https://arkade.computer',
        invoice: MAINNET_INVOICE,
        network: 'bitcoin',
        transport: {} as never,
        repository: harness.repository,
        contracts: harness.contracts,
        manager: lifecycle.manager,
        profile: MAINNET_TEST_PROFILE,
        requester: requester as never,
        nowSeconds: INVOICE_TIMESTAMP + 3,
        enabled: true,
      }),
    ).resolves.toMatchObject({ rfqId: replacement.rfqId })
    expect(requester).toHaveBeenCalledOnce()
    expect(await harness.repository.getRfqSwap(replacement.rfqId)).toBeDefined()

    await lifecycle.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('recovers one exact funding txid after a lost submit response and refuses ambiguous activity', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, fundingProof(quote), INVOICE_TIMESTAMP + 2)
    const fundingTxid = 'cd'.repeat(32)
    const indexer = {
      getVtxos: vi.fn(async ({ scripts }: { scripts: string[] }) => {
        expect(scripts).toEqual([hex.encode(harness.result.swapPkScript)])
        return { vtxos: [{ txid: fundingTxid, vout: 0 }] }
      }),
    }

    await expect(reconcileVaultLightningFundingTxids(harness.repository, indexer as never)).resolves.toEqual([
      quote.rfqId,
    ])
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({ fundingArkTxid: fundingTxid })
    await expect(listVaultLightningActivityRecords(harness.repository)).resolves.toEqual([
      expect.objectContaining({ rfqId: quote.rfqId, fundingTxid, displayAmount: 2100, state: 'pending' }),
    ])

    await harness.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
    const ambiguous = await lightningQuoteHarness({ rfqId: 'bc'.repeat(32) })
    const ambiguousQuote = await ambiguous.request()
    await beginVaultLightningFunding(
      ambiguous.repository,
      ambiguousQuote.rfqId,
      fundingProof(ambiguousQuote),
      INVOICE_TIMESTAMP + 2,
    )
    const ambiguousIndexer = {
      getVtxos: vi.fn(async () => ({
        vtxos: [
          { txid: 'de'.repeat(32), vout: 0 },
          { txid: 'ef'.repeat(32), vout: 0 },
        ],
      })),
    }
    await expect(reconcileVaultLightningFundingTxids(ambiguous.repository, ambiguousIndexer as never)).resolves.toEqual(
      [],
    )
    expect((await ambiguous.repository.getRfqSwap(ambiguousQuote.rfqId))?.fundingArkTxid).toBeUndefined()
    await ambiguous.manager.stop()
    await ambiguous.repository[Symbol.asyncDispose]()
  })

  it('does not report a funding txid stored when the repository drops the write', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, fundingProof(quote), INVOICE_TIMESTAMP + 2)
    const repository = {
      getRfqSwap: harness.repository.getRfqSwap.bind(harness.repository),
      saveRfqSwap: vi.fn(async () => {}),
    }

    await expect(recordVaultLightningFundingTxid(repository, quote.rfqId, 'cd'.repeat(32))).rejects.toThrow(
      /not durably stored/,
    )
    expect((await harness.repository.getRfqSwap(quote.rfqId))?.fundingArkTxid).toBeUndefined()

    await harness.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('marks a refund due after reload without retaining a signing key', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, fundingProof(quote), INVOICE_TIMESTAMP + 2)
    await harness.manager.stop()

    const observer = await startTestObserver({
      repository: harness.repository,
      contracts: harness.contracts,
      indexer: emptyIndexer() as never,
      managerConfig: {
        pollIntervalMs: 60_000,
        now: () => quote.refundLocktime,
      },
    })

    expect(observer.restoreFailures).toEqual([])
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({ state: 'needs_counterparty' })

    await observer.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('keeps background polling unsigned, then refunds only inside the authenticated callback lifetime', async () => {
    const harness = await lightningQuoteHarness()
    const quote = await harness.request()
    await beginVaultLightningFunding(harness.repository, quote.rfqId, fundingProof(quote), INVOICE_TIMESTAMP + 2)
    await harness.manager.stop()
    const refundArkade = vi.fn(async () => ({ arkTxid: 'cd'.repeat(32), amount: quote.fundAmountSats }))
    const lifecycle = await startTestObserver({
      contracts: harness.contracts,
      indexer: emptyIndexer() as never,
      repository: harness.repository,
      managerConfig: {
        pollIntervalMs: 60_000,
        now: () => quote.refundLocktime,
      },
    })

    expect(refundArkade).not.toHaveBeenCalled()
    const action = vi.fn()
    const unsubscribe = lifecycle.manager.onActionExecuted(action)
    await lifecycle.manager.poll()
    expect(refundArkade).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()

    await withAuthenticatedVaultLightningRefund(lifecycle.manager, quote.rfqId, refundArkade, async () => {
      expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({ state: 'refunded' })
    })
    expect(refundArkade).toHaveBeenCalledOnce()
    expect(await harness.repository.getRfqSwap(quote.rfqId)).toMatchObject({
      state: 'refunded',
      refundArkTxid: 'cd'.repeat(32),
    })
    expect(harness.rows.get(hex.encode(harness.result.swapPkScript))?.watch).toBe('retained')

    unsubscribe()
    await lifecycle.manager.stop()
    await harness.repository[Symbol.asyncDispose]()
  })

  it('restores fail-closed refund callbacks when authenticated work throws', async () => {
    let callbacks: Parameters<RfqSwapManager['setCallbacks']>[0] | undefined
    const manager = {
      setCallbacks: vi.fn((next: Parameters<RfqSwapManager['setCallbacks']>[0]) => {
        callbacks = next
      }),
      poll: vi.fn(async () => undefined),
      getPendingSwaps: vi.fn(async () => []),
      removeSwap: vi.fn(async () => undefined),
      restoreFromRepository: vi.fn(async () => ({ restored: [], failed: [], pruned: [] })),
    }
    const refundArkade = vi.fn(async () => null)

    await expect(
      withAuthenticatedVaultLightningRefund(manager, 'ab'.repeat(32), refundArkade, async () => {
        throw new Error('status read failed')
      }),
    ).rejects.toThrow('status read failed')

    expect(manager.setCallbacks).toHaveBeenCalledTimes(2)
    const authenticatedCallbacks = manager.setCallbacks.mock.calls[0]?.[0]
    if (!authenticatedCallbacks) throw new Error('authenticated callbacks were not installed')
    await expect(
      authenticatedCallbacks.canRefundArkade!({ rfqId: 'ab'.repeat(32), refundLocktime: 0 } as never),
    ).resolves.toEqual({ ok: true })
    await expect(
      authenticatedCallbacks.canRefundArkade!({ rfqId: 'cd'.repeat(32), refundLocktime: 0 } as never),
    ).resolves.toEqual({ ok: false, reason: 'Face ID is required to return this payment to Spending.' })
    await expect(authenticatedCallbacks.refundArkade({ rfqId: 'ab'.repeat(32) } as never)).resolves.toBeNull()
    await expect(authenticatedCallbacks.refundArkade({ rfqId: 'cd'.repeat(32) } as never)).rejects.toBeInstanceOf(
      RefundNotLocallyPossibleError,
    )
    expect(refundArkade).toHaveBeenCalledOnce()

    const restoredCallbacks = callbacks
    if (!restoredCallbacks) throw new Error('callbacks were not restored')
    await expect(restoredCallbacks.canRefundArkade!({ refundLocktime: 0 } as never)).resolves.toEqual({
      ok: false,
      reason: 'Face ID is required to return this payment to Spending.',
    })
    await expect(restoredCallbacks.refundArkade({} as never)).rejects.toBeInstanceOf(RefundNotLocallyPossibleError)
  })

  it('rechecks quote and invoice expiry immediately before funding', () => {
    const quote = { invoiceExpiresAt: 200, validUntil: 100 } as VaultLightningQuote
    expect(() => assertVaultLightningQuoteCurrent(quote, 99)).not.toThrow()
    expect(() => assertVaultLightningQuoteCurrent(quote, 100)).toThrow(/quote has expired/)
    expect(() => assertVaultLightningQuoteCurrent({ ...quote, validUntil: 300 }, 200)).toThrow(/invoice has expired/)
  })
})

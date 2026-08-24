import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAddressTxs, fetchAddressUtxos } from '../lib/vault/esplora'
import { pinFromEnrolledStatus, saveAddressPin } from '../lib/vault/pin'
import { fetchVaultStatus } from '../lib/vault/status'
import { unlockPhoneBip340 } from '../lib/vault/savingsSpend'
import type { EnrollmentSecrets } from '../lib/vault/tenantEnrollment'
import type { VaultStatus } from '../lib/vault/types'
import { fetchVaultBoardingFunds, vaultBoardingIntentStatus, withVaultBoardingLock } from '../lib/vault/vtxo/board'
import {
  fetchVaultReadonlyVtxoSnapshot,
  reloadVaultReadonlyWorker,
  subscribeVaultReadonlyEvents,
} from '../lib/vault/vtxo/readonlyWorker'
import {
  boardingSettlementAttemptKey,
  confirmedUtxoBalance,
  savingsUtxoBalance,
  useVaultBalances,
} from './useVaultBalances'

vi.mock('../lib/vault/esplora', () => ({
  fetchAddressTxs: vi.fn(),
  fetchAddressUtxos: vi.fn(),
}))
vi.mock('../lib/vault/status', () => ({ fetchVaultStatus: vi.fn() }))
vi.mock('../lib/vault/savingsSpend', () => ({ unlockPhoneBip340: vi.fn() }))
vi.mock('../lib/vault/vtxo/spend', () => ({
  reconcilePersistedVtxoSpend: vi.fn().mockResolvedValue({ kind: 'none' }),
}))
vi.mock('../lib/vault/vtxo/readonlyWorker', () => ({
  fetchVaultReadonlyVtxoSnapshot: vi.fn(),
  reloadVaultReadonlyWorker: vi.fn().mockResolvedValue(undefined),
  subscribeVaultReadonlyEvents: vi.fn().mockReturnValue(() => undefined),
}))
vi.mock('../lib/vault/vtxo/board', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/vault/vtxo/board')>()),
  fetchVaultBoardingFunds: vi.fn(),
  vaultBoardingIntentStatus: vi.fn(),
  withVaultBoardingLock: vi.fn(),
}))

const STATUS: VaultStatus = {
  enrolled: true,
  network: 'mutinynet',
  clientOrigin: 'https://vault.test',
  rpId: 'vault.test',
  vaultId: 'vault-a',
  templateVersion: 'savings-v1',
  policyVersion: 'policy-v1',
  savingsAddress: 'tb1psavings',
  savingsScript: '51',
  periodAllowance: 100_000,
  periodSpent: 0,
  periodRemaining: 100_000,
  txCap: 50_000,
  absoluteFeeCap: 1_500,
  feerateCapSatVb: 10,
  vtxoVaultCosignerPub: '02' + '11'.repeat(32),
  vtxoExitDelay: 4608,
  vtxoExitDelayUnit: 'seconds',
  spendingArkAddress: 'tark1spending',
  spendingArkScript: '5120' + '22'.repeat(32),
  vtxoDelegatePub: '02' + '33'.repeat(32),
  vtxoBoardingActive: false,
  vtxoBoardingProgram: 'vault-board-v1',
  vtxoBoardingAddress: 'tb1pboarding',
  vtxoBoardingScript: '5120' + '44'.repeat(32),
  vtxoBoardingExitDelay: 604672,
  vtxoBoardingExitDelayUnit: 'seconds',
}

const mockedStatus = vi.mocked(fetchVaultStatus)
const mockedUtxos = vi.mocked(fetchAddressUtxos)
const mockedTxs = vi.mocked(fetchAddressTxs)
const mockedSnapshot = vi.mocked(fetchVaultReadonlyVtxoSnapshot)
const mockedWorkerReload = vi.mocked(reloadVaultReadonlyWorker)
const mockedWorkerEvents = vi.mocked(subscribeVaultReadonlyEvents)
const mockedBoardingFunds = vi.mocked(fetchVaultBoardingFunds)
const mockedBoardingIntentStatus = vi.mocked(vaultBoardingIntentStatus)
const mockedBoardingLock = vi.mocked(withVaultBoardingLock)
const mockedUnlockPhone = vi.mocked(unlockPhoneBip340)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setupHook(
  locked = true,
  status: VaultStatus | null = STATUS,
  initialStatusChecked = true,
  enrollment: EnrollmentSecrets | null = null,
  withPin = true,
  persistPin = true,
) {
  const builtPin = withPin ? pinFromEnrolledStatus(status || STATUS) : null
  const pin = builtPin && persistPin ? saveAddressPin(builtPin) : builtPin
  const setStatus = vi.fn()
  const reportError = vi.fn()
  const onBoarded = vi.fn()
  const hook = renderHook(() =>
    useVaultBalances({
      addressPin: pin,
      busy: false,
      enrollment,
      initialStatusChecked,
      locked,
      onBoarded,
      reportError,
      setStatus,
      status,
    }),
  )
  return { ...hook, reportError, setStatus }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mockedStatus.mockResolvedValue(STATUS)
  mockedUtxos.mockResolvedValue([])
  mockedTxs.mockResolvedValue([])
  mockedSnapshot.mockResolvedValue({ balance: 0, history: [] })
  mockedWorkerReload.mockResolvedValue(undefined)
  mockedWorkerEvents.mockReturnValue(() => undefined)
  mockedBoardingFunds.mockResolvedValue({ total: 0, confirmed: 0, confirmedOutpoints: [], history: [], unconfirmed: 0 })
  mockedBoardingIntentStatus.mockResolvedValue('none')
  mockedBoardingLock.mockImplementation(async (_vaultId, run) => ({
    held: true,
    value: await run({} as never),
  }))
})

afterEach(() => vi.useRealTimers())

describe('confirmedUtxoBalance', () => {
  it('counts unique confirmed and currently unspent Savings outputs', () => {
    const confirmed = { txid: 'a', vout: 0, value: 12_000, status: { confirmed: true } }
    expect(
      confirmedUtxoBalance([confirmed, confirmed, { txid: 'b', vout: 0, value: 8_000, status: { confirmed: false } }]),
    ).toBe(12_000)
  })
})

describe('boardingSettlementAttemptKey', () => {
  it('identifies exact sorted outpoints instead of aggregate value', () => {
    expect(boardingSettlementAttemptKey('vault-a', ['second:1', 'first:0'])).toBe('vault-a:settle:first:0,second:1')
    expect(boardingSettlementAttemptKey('vault-a', ['replacement:0'])).not.toBe(
      boardingSettlementAttemptKey('vault-a', ['first:0']),
    )
  })
})

describe('savingsUtxoBalance', () => {
  it('shows pending wallet-owned change but keeps only confirmed coins spendable', () => {
    const address = 'tb1psavings'
    const balance = savingsUtxoBalance(
      [
        { txid: 'old-a', vout: 0, value: 47_260, status: { confirmed: true } },
        { txid: 'old-b', vout: 0, value: 32_260, status: { confirmed: true } },
        { txid: 'send', vout: 1, value: 418_100, status: { confirmed: false } },
      ],
      [
        {
          txid: 'send',
          vin: [{ prevout: { scriptpubkey_address: address, value: 519_600 } }],
          vout: [
            { scriptpubkey_address: 'tb1pboarding', value: 100_000 },
            { scriptpubkey_address: address, value: 418_100 },
          ],
          status: { confirmed: false },
        },
      ],
      address,
    )

    expect(balance).toEqual({ total: 497_620, spendable: 79_520 })
  })

  it('does not show an unconfirmed external deposit', () => {
    const address = 'tb1psavings'
    const incoming = { txid: 'incoming', vout: 0, value: 90_000, status: { confirmed: false } }
    const balance = savingsUtxoBalance(
      [incoming, incoming],
      [
        {
          txid: 'incoming',
          vin: [{ prevout: { scriptpubkey_address: 'tb1psender', value: 90_500 } }],
          vout: [{ scriptpubkey_address: address, value: 90_000 }],
          status: { confirmed: false },
        },
      ],
      address,
    )

    expect(balance).toEqual({ total: 0, spendable: 0 })
  })
})

describe('useVaultBalances refresh coordination', () => {
  it('uses and verifies the recovered in-memory pin when private storage is unavailable', async () => {
    mockedUtxos.mockResolvedValue([{ txid: 'saved', vout: 0, value: 42_000, status: { confirmed: true } }])
    const { result } = setupHook(true, STATUS, true, null, true, false)

    await act(async () => result.current.refreshBalance())

    expect(mockedUtxos).toHaveBeenCalledWith(STATUS.savingsAddress)
    expect(result.current.savingsSats).toBe(42_000)
  })

  it('ignores an older refresh that finishes after a newer snapshot', async () => {
    const older = deferred<Awaited<ReturnType<typeof fetchAddressUtxos>>>()
    mockedUtxos
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValueOnce([{ txid: 'new', vout: 0, value: 25_000, status: { confirmed: true } }])
    mockedSnapshot
      .mockResolvedValueOnce({ balance: 10_000, history: [] })
      .mockResolvedValueOnce({ balance: 30_000, history: [] })

    const { result } = setupHook()
    let first!: Promise<void>
    let second!: Promise<void>
    await act(async () => {
      first = result.current.refreshBalance()
      second = result.current.refreshBalance()
      await second
    })
    expect(result.current.savingsSats).toBe(25_000)
    expect(result.current.savingsSpendableSats).toBe(25_000)
    expect(result.current.vtxoSpendingSats).toBe(30_000)

    await act(async () => {
      older.resolve([{ txid: 'old', vout: 0, value: 5_000, status: { confirmed: true } }])
      await first
    })
    expect(result.current.savingsSats).toBe(25_000)
    expect(result.current.savingsSpendableSats).toBe(25_000)
    expect(result.current.vtxoSpendingSats).toBe(30_000)
  })

  it('keeps the previous account snapshot when any balance or history read fails', async () => {
    mockedUtxos.mockResolvedValueOnce([{ txid: 'old', vout: 0, value: 20_000, status: { confirmed: true } }])
    mockedSnapshot.mockResolvedValueOnce({
      balance: 15_000,
      history: [
        {
          txid: 'old-spend',
          type: 'received',
          amount: 15_000,
          confirmed: true,
          blockTime: 1,
          account: 'spend',
        },
      ],
    })
    const { reportError, result } = setupHook()
    await act(async () => {
      await result.current.refreshBalance()
    })

    mockedUtxos.mockResolvedValueOnce([{ txid: 'new', vout: 0, value: 40_000, status: { confirmed: true } }])
    mockedSnapshot.mockRejectedValueOnce(new Error('activity unavailable'))
    await act(async () => {
      await result.current.refreshBalance()
    })

    expect(result.current.savingsSats).toBe(20_000)
    expect(result.current.savingsSpendableSats).toBe(20_000)
    expect(result.current.vtxoSpendingSats).toBe(15_000)
    expect(result.current.history.map((item) => item.txid)).toEqual(['old-spend'])
    expect(result.current.balanceError).toBe('Something went wrong. Try again.')
    expect(reportError).not.toHaveBeenCalled()
  })

  it('publishes loading state and the fresh policy status with a completed snapshot', async () => {
    const pending = deferred<Awaited<ReturnType<typeof fetchAddressUtxos>>>()
    mockedUtxos.mockImplementationOnce(() => pending.promise)
    const { result, setStatus } = setupHook()

    let refresh!: Promise<void>
    act(() => {
      refresh = result.current.refreshBalance()
    })
    expect(result.current.refreshingBalance).toBe(true)
    expect(result.current.balancesLoaded).toBe(false)

    await act(async () => {
      pending.resolve([])
      await refresh
    })
    expect(result.current.refreshingBalance).toBe(false)
    expect(result.current.balancesLoaded).toBe(true)
    expect(setStatus).toHaveBeenCalledWith(STATUS)
  })

  it('refreshes once when an unlocked vault mounts and once when the window regains focus', async () => {
    setupHook(false)

    await waitFor(() => expect(mockedStatus).toHaveBeenCalledTimes(1))
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(mockedStatus).toHaveBeenCalledTimes(2))
  })

  it('recovers a cold reload from the persisted enrollment after the initial status check fails', async () => {
    const enrollment = { vaultId: STATUS.vaultId } as EnrollmentSecrets
    mockedSnapshot.mockResolvedValueOnce({ balance: 12_000, history: [] })
    const { result } = setupHook(false, null, true, enrollment, false)

    await waitFor(() => expect(mockedStatus).toHaveBeenCalledWith(undefined, STATUS.vaultId))
    await waitFor(() => expect(result.current.balancesLoaded).toBe(true))
    expect(result.current.vtxoSpendingSats).toBe(12_000)
    expect(mockedSnapshot).toHaveBeenCalledTimes(1)
  })

  it('waits for the initial status check before using persisted recovery state', async () => {
    const pin = saveAddressPin(pinFromEnrolledStatus(STATUS))
    const setStatus = vi.fn()
    const { rerender } = renderHook(
      ({ checked }) =>
        useVaultBalances({
          addressPin: pin,
          busy: false,
          enrollment: null,
          initialStatusChecked: checked,
          locked: false,
          onBoarded: vi.fn(),
          reportError: vi.fn(),
          setStatus,
          status: null,
        }),
      { initialProps: { checked: false } },
    )

    expect(mockedStatus).not.toHaveBeenCalled()
    rerender({ checked: true })
    await waitFor(() => expect(mockedStatus).toHaveBeenCalledWith(undefined, STATUS.vaultId))
  })

  it('uses the 15-second timer only for boarding funds and preserves the wallet snapshot', async () => {
    vi.useFakeTimers()
    const active = { ...STATUS, vtxoBoardingActive: true, vtxoBoardingAddress: 'tb1pboarding' }
    mockedStatus.mockResolvedValue(active)
    mockedSnapshot.mockResolvedValue({
      balance: 30_000,
      history: [
        {
          txid: 'spend-history',
          type: 'received',
          amount: 30_000,
          confirmed: true,
          account: 'spend',
        },
      ],
    })
    mockedBoardingFunds.mockResolvedValueOnce({
      total: 1_000,
      confirmed: 0,
      confirmedOutpoints: [],
      history: [
        {
          txid: 'boarding-pending',
          type: 'received',
          amount: 1_000,
          confirmed: false,
          account: 'spend',
          activity: 'boarding',
        },
      ],
      unconfirmed: 1_000,
    })
    const { result } = setupHook(false, active)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.balancesLoaded).toBe(true)

    mockedStatus.mockClear()
    mockedUtxos.mockClear()
    mockedTxs.mockClear()
    mockedSnapshot.mockClear()
    mockedBoardingFunds.mockClear()
    mockedBoardingFunds.mockResolvedValueOnce({
      total: 1_000,
      confirmed: 1_000,
      confirmedOutpoints: ['confirmed:0'],
      history: [
        {
          txid: 'boarding-confirmed',
          type: 'received',
          amount: 1_000,
          confirmed: false,
          account: 'spend',
          activity: 'boarding',
        },
      ],
      unconfirmed: 0,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(mockedBoardingFunds).toHaveBeenCalledTimes(1)
    expect(mockedStatus).not.toHaveBeenCalled()
    expect(mockedUtxos).not.toHaveBeenCalled()
    expect(mockedTxs).not.toHaveBeenCalled()
    expect(mockedSnapshot).not.toHaveBeenCalled()
    expect(result.current.vtxoSpendingSats).toBe(30_000)
    expect(result.current.history.map((item) => item.txid)).toEqual(['spend-history', 'boarding-confirmed'])
    expect(result.current.boardingConfirmedBalance).toBe(1_000)
  })

  it('rechecks a fresh active boarding intent without requesting Face ID', async () => {
    vi.useFakeTimers()
    const active = { ...STATUS, vtxoBoardingActive: true, vtxoBoardingAddress: 'tb1pboarding' }
    mockedStatus.mockResolvedValue(active)
    mockedBoardingFunds.mockResolvedValue({
      total: 1_000,
      confirmed: 1_000,
      confirmedOutpoints: ['11'.repeat(32) + ':0'],
      history: [],
      unconfirmed: 0,
    })
    mockedBoardingIntentStatus.mockResolvedValue('active')

    setupHook(false, active, true, { vaultId: active.vaultId } as EnrollmentSecrets)
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve()
    })

    expect(mockedBoardingIntentStatus).toHaveBeenCalledTimes(1)
    expect(mockedUnlockPhone).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(mockedBoardingIntentStatus).toHaveBeenCalledTimes(2)
    expect(mockedUnlockPhone).not.toHaveBeenCalled()
  })

  it('ignores a narrow boarding poll superseded by a full refresh', async () => {
    vi.useFakeTimers()
    const active = { ...STATUS, vtxoBoardingActive: true, vtxoBoardingAddress: 'tb1pboarding' }
    mockedStatus.mockResolvedValue(active)
    mockedBoardingFunds.mockResolvedValueOnce({
      total: 1_000,
      confirmed: 0,
      confirmedOutpoints: [],
      history: [],
      unconfirmed: 1_000,
    })
    const { result } = setupHook(false, active)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const olderPoll = deferred<Awaited<ReturnType<typeof fetchVaultBoardingFunds>>>()
    mockedBoardingFunds
      .mockImplementationOnce(() => olderPoll.promise)
      .mockResolvedValueOnce({
        total: 2_000,
        confirmed: 2_000,
        confirmedOutpoints: ['new:0'],
        history: [],
        unconfirmed: 0,
      })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    await act(async () => {
      await result.current.refreshBalance()
    })
    expect(result.current.boardingConfirmedBalance).toBe(2_000)

    await act(async () => {
      olderPoll.resolve({
        total: 1_000,
        confirmed: 1_000,
        confirmedOutpoints: ['old:0'],
        history: [],
        unconfirmed: 0,
      })
      await olderPoll.promise
    })
    expect(result.current.boardingConfirmedBalance).toBe(2_000)
  })

  it('invalidates an in-flight boarding poll and stops its timer on unmount', async () => {
    vi.useFakeTimers()
    const active = { ...STATUS, vtxoBoardingActive: true, vtxoBoardingAddress: 'tb1pboarding' }
    mockedStatus.mockResolvedValue(active)
    mockedBoardingFunds.mockResolvedValueOnce({
      total: 1_000,
      confirmed: 0,
      confirmedOutpoints: [],
      history: [],
      unconfirmed: 1_000,
    })
    const { unmount } = setupHook(false, active)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const pendingPoll = deferred<Awaited<ReturnType<typeof fetchVaultBoardingFunds>>>()
    mockedBoardingFunds.mockClear()
    mockedBoardingFunds.mockImplementationOnce(() => pendingPoll.promise)
    act(() => vi.advanceTimersByTime(15_000))
    expect(mockedBoardingFunds).toHaveBeenCalledTimes(1)

    unmount()
    await act(async () => {
      pendingPoll.resolve({
        total: 1_000,
        confirmed: 1_000,
        confirmedOutpoints: ['pending:0'],
        history: [],
        unconfirmed: 0,
      })
      await pendingPoll.promise
      vi.advanceTimersByTime(30_000)
    })
    expect(mockedBoardingFunds).toHaveBeenCalledTimes(1)
  })
})

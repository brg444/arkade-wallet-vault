import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAddressTxs, fetchAddressUtxos } from '../lib/vault/esplora'
import { pinFromEnrolledStatus, saveAddressPin } from '../lib/vault/pin'
import { fetchVaultStatus } from '../lib/vault/status'
import type { VaultStatus } from '../lib/vault/types'
import { fetchVaultVtxoFunds, fetchVaultVtxoHistory } from '../lib/vault/vtxo/spend'
import { confirmedUtxoBalance, useVaultBalances } from './useVaultBalances'

vi.mock('../lib/vault/esplora', () => ({
  fetchAddressTxs: vi.fn(),
  fetchAddressUtxos: vi.fn(),
}))
vi.mock('../lib/vault/status', () => ({ fetchVaultStatus: vi.fn() }))
vi.mock('../lib/vault/vtxo/spend', () => ({
  fetchVaultVtxoFunds: vi.fn(),
  fetchVaultVtxoHistory: vi.fn(),
  reconcilePersistedVtxoSpend: vi.fn().mockResolvedValue({ kind: 'none' }),
}))
vi.mock('../lib/vault/vtxo/board', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/vault/vtxo/board')>()),
  fetchVaultBoardingFunds: vi.fn(),
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
  spendingArkAddress: 'tark1spending',
  vtxoBoardingActive: false,
}

const mockedStatus = vi.mocked(fetchVaultStatus)
const mockedUtxos = vi.mocked(fetchAddressUtxos)
const mockedTxs = vi.mocked(fetchAddressTxs)
const mockedFunds = vi.mocked(fetchVaultVtxoFunds)
const mockedHistory = vi.mocked(fetchVaultVtxoHistory)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setupHook(locked = true) {
  const pin = saveAddressPin(pinFromEnrolledStatus(STATUS))
  const setStatus = vi.fn()
  const reportError = vi.fn()
  const onBoarded = vi.fn()
  const setSpend = vi.fn()
  const hook = renderHook(() =>
    useVaultBalances({
      addressPin: pin,
      busy: false,
      enrollment: null,
      liveFeeSats: 1_500,
      locked,
      onBoarded,
      reportError,
      setSpend,
      setStatus,
      status: STATUS,
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
  mockedFunds.mockResolvedValue({ balance: 0, maxCoin: 0 })
  mockedHistory.mockResolvedValue([])
})

describe('confirmedUtxoBalance', () => {
  it('counts unique confirmed and currently unspent Savings outputs', () => {
    const confirmed = { txid: 'a', vout: 0, value: 12_000, status: { confirmed: true } }
    expect(
      confirmedUtxoBalance([confirmed, confirmed, { txid: 'b', vout: 0, value: 8_000, status: { confirmed: false } }]),
    ).toBe(12_000)
  })
})

describe('useVaultBalances refresh coordination', () => {
  it('ignores an older refresh that finishes after a newer snapshot', async () => {
    const older = deferred<Awaited<ReturnType<typeof fetchAddressUtxos>>>()
    mockedUtxos
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValueOnce([{ txid: 'new', vout: 0, value: 25_000, status: { confirmed: true } }])
    mockedFunds
      .mockResolvedValueOnce({ balance: 10_000, maxCoin: 10_000 })
      .mockResolvedValueOnce({ balance: 30_000, maxCoin: 30_000 })

    const { result } = setupHook()
    let first!: Promise<void>
    let second!: Promise<void>
    await act(async () => {
      first = result.current.refreshBalance()
      second = result.current.refreshBalance()
      await second
    })
    expect(result.current.savingsSats).toBe(25_000)
    expect(result.current.vtxoSpendingSats).toBe(30_000)

    await act(async () => {
      older.resolve([{ txid: 'old', vout: 0, value: 5_000, status: { confirmed: true } }])
      await first
    })
    expect(result.current.savingsSats).toBe(25_000)
    expect(result.current.vtxoSpendingSats).toBe(30_000)
  })

  it('keeps the previous account snapshot when any balance or history read fails', async () => {
    mockedUtxos.mockResolvedValueOnce([{ txid: 'old', vout: 0, value: 20_000, status: { confirmed: true } }])
    mockedFunds.mockResolvedValueOnce({ balance: 15_000, maxCoin: 15_000 })
    mockedHistory.mockResolvedValueOnce([
      {
        txid: 'old-spend',
        type: 'received',
        amount: 15_000,
        confirmed: true,
        blockTime: 1,
        account: 'spend',
      },
    ])
    const { reportError, result } = setupHook()
    await act(async () => {
      await result.current.refreshBalance()
    })

    mockedUtxos.mockResolvedValueOnce([{ txid: 'new', vout: 0, value: 40_000, status: { confirmed: true } }])
    mockedFunds.mockResolvedValueOnce({ balance: 35_000, maxCoin: 35_000 })
    mockedHistory.mockRejectedValueOnce(new Error('activity unavailable'))
    await act(async () => {
      await result.current.refreshBalance()
    })

    expect(result.current.savingsSats).toBe(20_000)
    expect(result.current.vtxoSpendingSats).toBe(15_000)
    expect(result.current.history.map((item) => item.txid)).toEqual(['old-spend'])
    expect(result.current.balanceError).toMatch(/activity unavailable/i)
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
})

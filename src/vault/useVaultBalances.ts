import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { consoleError } from '../lib/logs'
import { fetchAddressTxs, fetchAddressUtxos, type EsploraTx, type EsploraUtxo } from '../lib/vault/esplora'
import { applyLightningHistoryMetadata, historyFromTxs, type VaultHistoryItem } from '../lib/vault/history'
import { humanizeVaultError } from '../lib/vault/humanize'
import { vaultLightningSendEnabled } from '../lib/vault/lightningConfig'
import { loadAddressPin, requireStatusMatchesPin, type AddressPin } from '../lib/vault/pin'
import { unlockPhoneBip340 } from '../lib/vault/savingsSpend'
import { fetchVaultStatus } from '../lib/vault/status'
import type { EnrollmentSecrets } from '../lib/vault/tenantEnrollment'
import type { VaultStatus } from '../lib/vault/types'
import {
  boardingAttemptKeyAfterLock,
  boardingFailureHold,
  fetchVaultBoardingFunds,
  nextVaultBoardingAction,
  settleVaultBoarding,
  withVaultBoardingLock,
  withVaultBoardingSecret,
} from '../lib/vault/vtxo/board'
import { fetchVaultVtxoSnapshot, reconcilePersistedVtxoSpend, vaultArkServer } from '../lib/vault/vtxo/spend'

async function loadVaultLightningHistory(vaultId: string) {
  if (!vaultLightningSendEnabled()) return []
  try {
    const lightning = await import('../lib/vault/lightning')
    return await lightning.refreshVaultLightningHistory(vaultId, vaultArkServer())
  } catch (error) {
    // This local database only decorates transaction history. Authoritative
    // balances must remain available if browser metadata cannot be opened.
    consoleError(error, 'could not load Lightning history metadata')
    return []
  }
}

interface VaultBalancesOptions {
  addressPin: AddressPin | null
  busy: boolean
  enrollment: EnrollmentSecrets | null
  initialStatusChecked: boolean
  locked: boolean
  reportError: (message: string) => void
  setStatus: Dispatch<SetStateAction<VaultStatus | null>>
  status: VaultStatus | null
  onBoarded: (txid: string) => void
}

interface VaultBalanceSnapshot {
  boardingBalance: number
  boardingConfirmedBalance: number
  history: VaultHistoryItem[]
  savingsSats: number
  savingsSpendableSats: number
  vtxoSpendingSats: number
}

const EMPTY_BALANCES: VaultBalanceSnapshot = {
  boardingBalance: 0,
  boardingConfirmedBalance: 0,
  history: [],
  savingsSats: 0,
  savingsSpendableSats: 0,
  vtxoSpendingSats: 0,
}

export function confirmedUtxoBalance(utxos: EsploraUtxo[]): number {
  const unique = new Map<string, EsploraUtxo>()
  for (const utxo of utxos) unique.set(`${utxo.txid}:${utxo.vout}`, utxo)
  return [...unique.values()].reduce(
    (total, utxo) =>
      total + (utxo.status.confirmed && Number.isSafeInteger(utxo.value) && utxo.value > 0 ? utxo.value : 0),
    0,
  )
}

export interface SavingsBalance {
  total: number
  spendable: number
}

/**
 * Keeps change from a pending Savings send visible without treating an
 * unconfirmed external deposit as spendable or part of the displayed balance.
 */
export function savingsUtxoBalance(
  utxos: EsploraUtxo[],
  transactions: EsploraTx[],
  savingsAddress: string,
): SavingsBalance {
  const unique = new Map<string, EsploraUtxo>()
  for (const utxo of utxos) unique.set(`${utxo.txid}:${utxo.vout}`, utxo)
  const walletSpendTxids = new Set(
    transactions
      .filter(
        (transaction) =>
          !transaction.status.confirmed &&
          transaction.vin.some((input) => input.prevout?.scriptpubkey_address === savingsAddress),
      )
      .map((transaction) => transaction.txid),
  )
  let spendable = 0
  let pendingChange = 0
  for (const utxo of unique.values()) {
    if (!Number.isSafeInteger(utxo.value) || utxo.value <= 0) continue
    if (utxo.status.confirmed) spendable += utxo.value
    else if (walletSpendTxids.has(utxo.txid)) pendingChange += utxo.value
  }
  return { total: spendable + pendingChange, spendable }
}

// useVaultBalances is the only coordinator allowed to refresh account funds,
// resume a VTXO send, or settle a confirmed boarding output. UI components see
// balances and history, never Operator or indexer calls.
export function useVaultBalances({
  addressPin,
  busy,
  enrollment,
  initialStatusChecked,
  locked,
  onBoarded,
  reportError,
  setStatus,
  status,
}: VaultBalancesOptions) {
  const [snapshot, setSnapshot] = useState<VaultBalanceSnapshot>(EMPTY_BALANCES)
  const [balanceError, setBalanceError] = useState('')
  const [balancesLoaded, setBalancesLoaded] = useState(false)
  const [refreshingBalance, setRefreshingBalance] = useState(false)
  const [boardingInProgress, setBoardingInProgress] = useState(false)
  const [boardingPulse, setBoardingPulse] = useState(0)
  const boardingRun = useRef(false)
  const boardingPollRun = useRef(false)
  const boardingAttempt = useRef('')
  const boardingRetryAfter = useRef(0)
  const boardingFetchVersion = useRef(0)
  const refreshVersion = useRef(0)
  const statusRef = useRef(status)
  const addressPinRef = useRef(addressPin)
  const enrollmentRef = useRef(enrollment)
  statusRef.current = status
  addressPinRef.current = addressPin
  enrollmentRef.current = enrollment

  const refreshVaultId = status?.vaultId || enrollment?.vaultId || addressPin?.vaultId || ''

  const { boardingBalance, boardingConfirmedBalance, history, savingsSats, savingsSpendableSats, vtxoSpendingSats } =
    snapshot

  const refreshBalance = useCallback(
    async (vaultId?: string) => {
      const version = ++refreshVersion.current
      const boardingVersion = ++boardingFetchVersion.current
      setRefreshingBalance(true)
      try {
        const id = String(
          vaultId ||
            statusRef.current?.vaultId ||
            enrollmentRef.current?.vaultId ||
            addressPinRef.current?.vaultId ||
            '',
        ).trim()
        if (!id) {
          if (version !== refreshVersion.current) return
          setSnapshot(EMPTY_BALANCES)
          setBalancesLoaded(true)
          setBalanceError('')
          return
        }
        const memoryPin = addressPinRef.current
        const pin = memoryPin?.vaultId === id ? memoryPin : loadAddressPin(localStorage, id)
        const savingsAddress = pin?.savingsAddress || ''
        const fetchedStatus = await fetchVaultStatus(undefined, id)
        const liveStatus = pin ? requireStatusMatchesPin(fetchedStatus, pin) : fetchedStatus
        const spendingAddress = liveStatus?.spendingArkAddress || ''
        const boardingAddress = liveStatus?.vtxoBoardingAddress || ''
        if (!savingsAddress && !spendingAddress && !boardingAddress) {
          if (version !== refreshVersion.current) return
          setStatus(liveStatus)
          setSnapshot(EMPTY_BALANCES)
          setBalancesLoaded(true)
          setBalanceError('')
          return
        }
        const [savings, spending, boarding] = await Promise.all([
          savingsAddress
            ? Promise.all([fetchAddressUtxos(savingsAddress), fetchAddressTxs(savingsAddress)]).then(
                ([utxos, transactions]) => {
                  const balance = savingsUtxoBalance(utxos, transactions, savingsAddress)
                  return {
                    balance: balance.total,
                    spendable: balance.spendable,
                    history: historyFromTxs(transactions, savingsAddress, 'savings'),
                  }
                },
              )
            : Promise.resolve({ balance: 0, spendable: 0, history: [] as VaultHistoryItem[] }),
          spendingAddress && liveStatus.enrolled
            ? Promise.all([fetchVaultVtxoSnapshot(liveStatus), loadVaultLightningHistory(liveStatus.vaultId)]).then(
                ([vtxos, lightning]) => ({
                  ...vtxos,
                  history: applyLightningHistoryMetadata(vtxos.history, lightning),
                }),
              )
            : Promise.resolve({ balance: 0, history: [] as VaultHistoryItem[] }),
          boardingAddress && liveStatus.enrolled && liveStatus.vtxoBoardingActive
            ? fetchVaultBoardingFunds(liveStatus)
            : Promise.resolve({ total: 0, confirmed: 0 }),
        ])
        if (version !== refreshVersion.current) return
        setStatus(liveStatus)
        setSnapshot((previous) => ({
          boardingBalance: boardingVersion === boardingFetchVersion.current ? boarding.total : previous.boardingBalance,
          boardingConfirmedBalance:
            boardingVersion === boardingFetchVersion.current ? boarding.confirmed : previous.boardingConfirmedBalance,
          history: [...savings.history, ...spending.history],
          savingsSats: savings.balance,
          savingsSpendableSats: savings.spendable,
          vtxoSpendingSats: spending.balance,
        }))
        setBalancesLoaded(true)
        setBalanceError('')
      } catch (error) {
        if (version === refreshVersion.current) setBalanceError(humanizeVaultError(error))
      } finally {
        if (version === refreshVersion.current) setRefreshingBalance(false)
      }
    },
    [setStatus],
  )

  const pollBoardingFunds = useCallback(async () => {
    const current = statusRef.current
    if (boardingPollRun.current || !current?.enrolled || !current.vtxoBoardingActive || !current.vtxoBoardingAddress) {
      return
    }
    const version = ++boardingFetchVersion.current
    boardingPollRun.current = true
    try {
      const funds = await fetchVaultBoardingFunds(current)
      if (version !== boardingFetchVersion.current) return
      setSnapshot((previous) => ({
        ...previous,
        boardingBalance: funds.total,
        boardingConfirmedBalance: funds.confirmed,
      }))
      setBoardingPulse((value) => value + 1)
    } catch (error) {
      if (version === boardingFetchVersion.current) consoleError(error, 'boarding funds poll')
    } finally {
      boardingPollRun.current = false
    }
  }, [])

  const settleConfirmedBoarding = useCallback(async () => {
    if (boardingRun.current || !status?.enrolled || !enrollment) return
    if (!status.vtxoBoardingActive || !status.vtxoBoardingAddress) return
    const action = nextVaultBoardingAction({ confirmed: boardingConfirmedBalance, total: boardingBalance })
    if (action !== 'settle') return
    boardingRun.current = true
    reportError('')
    try {
      const settled = await withVaultBoardingLock(status.vaultId, async (boardingLock) => {
        setBoardingInProgress(true)
        const phoneSecret = await unlockPhoneBip340(enrollment, status)
        return withVaultBoardingSecret(phoneSecret, (liveSecret) =>
          settleVaultBoarding(boardingLock, liveSecret, status),
        )
      })
      if (!settled.held) {
        boardingAttempt.current = boardingAttemptKeyAfterLock(false, '')
        return
      }
      boardingAttempt.current = `${status.vaultId}:settle:${boardingConfirmedBalance}:${boardingBalance}`
      onBoarded(settled.value.txid)
      boardingRetryAfter.current = 0
      await refreshBalance(status.vaultId)
    } catch (error) {
      consoleError(error, 'automatic Spending transfer')
      reportError('')
      const hold = boardingFailureHold(error, `${status.vaultId}:settle:${boardingConfirmedBalance}:${boardingBalance}`)
      boardingAttempt.current = hold.attemptKey
      boardingRetryAfter.current = Date.now() + hold.retryDelayMs
      await refreshBalance(status.vaultId)
    } finally {
      boardingRun.current = false
      setBoardingInProgress(false)
    }
  }, [boardingBalance, boardingConfirmedBalance, enrollment, onBoarded, refreshBalance, reportError, status])

  useEffect(() => {
    if (busy || boardingInProgress || locked || !enrollment || !status?.enrolled || !status.vtxoBoardingActive) return
    const action = nextVaultBoardingAction({ confirmed: boardingConfirmedBalance, total: boardingBalance })
    if (action === 'idle' || action === 'wait') {
      boardingAttempt.current = ''
      return
    }
    if (Date.now() < boardingRetryAfter.current) return
    const key = `${status.vaultId}:${action}:${boardingConfirmedBalance}:${boardingBalance}`
    if (boardingAttempt.current === key) return
    void settleConfirmedBoarding()
  }, [
    boardingBalance,
    boardingConfirmedBalance,
    boardingInProgress,
    boardingPulse,
    busy,
    enrollment,
    locked,
    settleConfirmedBoarding,
    status,
  ])

  const recoverVtxoSpend = useCallback(async () => {
    const current = statusRef.current
    if (!current?.enrolled || !current.vaultId) return
    try {
      const result = await reconcilePersistedVtxoSpend(current)
      if (result.kind === 'receipt-finalized') await refreshBalance(current.vaultId)
    } catch (error) {
      consoleError(error, 'VTXO spend recovery')
    }
  }, [refreshBalance])

  useEffect(() => {
    refreshVersion.current += 1
    boardingFetchVersion.current += 1
    setSnapshot(EMPTY_BALANCES)
    setBalancesLoaded(false)
    setBalanceError('')
    setRefreshingBalance(false)
  }, [refreshVaultId])

  useEffect(() => {
    if (locked || !initialStatusChecked || !refreshVaultId) return
    void refreshBalance(refreshVaultId)
  }, [initialStatusChecked, locked, refreshBalance, refreshVaultId])

  useEffect(() => {
    if (locked || !initialStatusChecked || !refreshVaultId) return
    if (status?.enrolled) void recoverVtxoSpend()
    const poll = () => {
      if (document.visibilityState === 'hidden') return
      void pollBoardingFunds()
    }
    const onFocus = () => {
      boardingAttempt.current = ''
      if (status?.enrolled) void recoverVtxoSpend()
      void refreshBalance(refreshVaultId)
    }
    const timer = status?.enrolled && status.vtxoBoardingActive ? window.setInterval(poll, 15_000) : 0
    window.addEventListener('focus', onFocus)
    return () => {
      if (timer) window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [
    initialStatusChecked,
    locked,
    pollBoardingFunds,
    recoverVtxoSpend,
    refreshBalance,
    refreshVaultId,
    status?.enrolled,
    status?.vtxoBoardingActive,
  ])

  useEffect(
    () => () => {
      refreshVersion.current += 1
      boardingFetchVersion.current += 1
    },
    [],
  )

  return {
    balanceError,
    balancesLoaded,
    boardingBalance,
    boardingConfirmedBalance,
    boardingInProgress,
    history,
    refreshBalance,
    refreshingBalance,
    savingsSats,
    savingsSpendableSats,
    vtxoSpendingSats,
  }
}

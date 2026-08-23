import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { consoleError } from '../lib/logs'
import { isVaultArkAddress } from '../lib/vault/bitcoin'
import { DUST_SATS } from '../lib/vault/constants'
import { fetchAddressTxs, fetchAddressUtxos, type EsploraUtxo } from '../lib/vault/esplora'
import { historyFromTxs, type VaultHistoryItem } from '../lib/vault/history'
import { humanizeVaultError } from '../lib/vault/humanize'
import { loadAddressPin, type AddressPin } from '../lib/vault/pin'
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
import { fetchVaultVtxoFunds, fetchVaultVtxoHistory, reconcilePersistedVtxoSpend } from '../lib/vault/vtxo/spend'
import type { VaultSpend } from './context'

interface VaultBalancesOptions {
  addressPin: AddressPin | null
  busy: boolean
  enrollment: EnrollmentSecrets | null
  liveFeeSats: number
  locked: boolean
  reportError: (message: string) => void
  setSpend: Dispatch<SetStateAction<VaultSpend>>
  setStatus: Dispatch<SetStateAction<VaultStatus | null>>
  status: VaultStatus | null
  onBoarded: (txid: string) => void
}

interface VaultBalanceSnapshot {
  boardingBalance: number
  boardingConfirmedBalance: number
  history: VaultHistoryItem[]
  savingsSats: number
  vtxoMaxCoin: number
  vtxoSpendingSats: number
}

const EMPTY_BALANCES: VaultBalanceSnapshot = {
  boardingBalance: 0,
  boardingConfirmedBalance: 0,
  history: [],
  savingsSats: 0,
  vtxoMaxCoin: 0,
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

// useVaultBalances is the only coordinator allowed to refresh account funds,
// resume a VTXO send, or settle a confirmed boarding output. UI components see
// balances and history, never Operator or indexer calls.
export function useVaultBalances({
  addressPin,
  busy,
  enrollment,
  liveFeeSats,
  locked,
  onBoarded,
  reportError,
  setSpend,
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
  const boardingAttempt = useRef('')
  const boardingRetryAfter = useRef(0)
  const refreshVersion = useRef(0)
  const statusRef = useRef(status)
  const addressPinRef = useRef(addressPin)
  statusRef.current = status
  addressPinRef.current = addressPin

  const { boardingBalance, boardingConfirmedBalance, history, savingsSats, vtxoMaxCoin, vtxoSpendingSats } = snapshot

  const refreshBalance = useCallback(
    async (vaultId?: string) => {
      const version = ++refreshVersion.current
      setRefreshingBalance(true)
      try {
        const id = String(vaultId || statusRef.current?.vaultId || addressPinRef.current?.vaultId || '').trim()
        if (!id) {
          if (version !== refreshVersion.current) return
          setSnapshot(EMPTY_BALANCES)
          setBalancesLoaded(true)
          setBalanceError('')
          return
        }
        const pin = loadAddressPin(localStorage, id)
        const savingsAddress = pin?.savingsAddress || ''
        const liveStatus = await fetchVaultStatus(undefined, id)
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
                ([utxos, transactions]) => ({
                  balance: confirmedUtxoBalance(utxos),
                  history: historyFromTxs(transactions, savingsAddress, 'savings'),
                }),
              )
            : Promise.resolve({ balance: 0, history: [] as VaultHistoryItem[] }),
          spendingAddress && liveStatus.enrolled
            ? Promise.all([fetchVaultVtxoFunds(liveStatus), fetchVaultVtxoHistory(liveStatus)]).then(
                ([funds, spendingHistory]) => ({ ...funds, history: spendingHistory }),
              )
            : Promise.resolve({ balance: 0, maxCoin: 0, history: [] as VaultHistoryItem[] }),
          boardingAddress && liveStatus.enrolled && liveStatus.vtxoBoardingActive
            ? fetchVaultBoardingFunds(liveStatus)
            : Promise.resolve({ total: 0, confirmed: 0 }),
        ])
        if (version !== refreshVersion.current) return
        setStatus(liveStatus)
        setSnapshot({
          boardingBalance: boarding.total,
          boardingConfirmedBalance: boarding.confirmed,
          history: [...savings.history, ...spending.history],
          savingsSats: savings.balance,
          vtxoMaxCoin: spending.maxCoin,
          vtxoSpendingSats: spending.balance,
        })
        setBalancesLoaded(true)
        setBalanceError('')
        setSpend((previous) => ({
          ...previous,
          fee:
            isVaultArkAddress(previous.address, liveStatus.network) && spending.maxCoin >= previous.amount + DUST_SATS
              ? 0
              : liveStatus.network === 'mutinynet'
                ? liveFeeSats
                : previous.fee,
        }))
      } catch (error) {
        if (version === refreshVersion.current) setBalanceError(humanizeVaultError(error))
      } finally {
        if (version === refreshVersion.current) setRefreshingBalance(false)
      }
    },
    [liveFeeSats, setSpend, setStatus],
  )

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
    setSnapshot(EMPTY_BALANCES)
    setBalancesLoaded(false)
    setBalanceError('')
    setRefreshingBalance(false)
  }, [status?.vaultId])

  useEffect(() => {
    if (locked || !status?.enrolled || !status.vaultId) return
    void refreshBalance(status.vaultId)
  }, [locked, refreshBalance, status?.enrolled, status?.vaultId])

  useEffect(() => {
    if (locked || !status?.enrolled) return
    void recoverVtxoSpend()
    const pulse = () => {
      if (document.visibilityState === 'hidden') return
      void refreshBalance(status.vaultId)
      if (status.vtxoBoardingActive) setBoardingPulse((value) => value + 1)
    }
    const onFocus = () => {
      boardingAttempt.current = ''
      void recoverVtxoSpend()
      pulse()
    }
    const timer = status.vtxoBoardingActive ? window.setInterval(pulse, 15_000) : 0
    window.addEventListener('focus', onFocus)
    return () => {
      if (timer) window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [locked, recoverVtxoSpend, refreshBalance, status?.enrolled, status?.vaultId, status?.vtxoBoardingActive])

  useEffect(
    () => () => {
      refreshVersion.current += 1
    },
    [],
  )

  return {
    balanceError,
    balancesLoaded,
    boardingInProgress,
    history,
    refreshBalance,
    refreshingBalance,
    savingsSats,
    vtxoMaxCoin,
    vtxoSpendingSats,
  }
}

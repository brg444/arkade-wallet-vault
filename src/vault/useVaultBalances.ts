import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { consoleError } from '../lib/logs'
import { isVaultArkAddress } from '../lib/vault/bitcoin'
import { DUST_SATS } from '../lib/vault/constants'
import { fetchAddressStats, fetchAddressTxs } from '../lib/vault/esplora'
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
  status: VaultStatus | null
  onBoarded: (txid: string) => void
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
  status,
}: VaultBalancesOptions) {
  const [vtxoSpendingSats, setVtxoSpendingSats] = useState(0)
  const [vtxoMaxCoin, setVtxoMaxCoin] = useState(0)
  const [boardingBalance, setBoardingBalance] = useState(0)
  const [boardingConfirmedBalance, setBoardingConfirmedBalance] = useState(0)
  const [boardingInProgress, setBoardingInProgress] = useState(false)
  const [boardingPulse, setBoardingPulse] = useState(0)
  const [savingsSats, setSavingsSats] = useState(0)
  const [history, setHistory] = useState<VaultHistoryItem[]>([])
  const boardingRun = useRef(false)
  const boardingAttempt = useRef('')
  const boardingRetryAfter = useRef(0)

  const refreshBalance = useCallback(
    async (vaultId?: string) => {
      const id = String(vaultId || status?.vaultId || addressPin?.vaultId || '').trim()
      const pin = id ? loadAddressPin(localStorage, id) : null
      const savingsAddress = pin?.savingsAddress || ''
      try {
        const liveStatus = id && status?.vaultId !== id ? await fetchVaultStatus(undefined, id) : status
        const spendingAddress = liveStatus?.spendingArkAddress || ''
        const boardingAddress = liveStatus?.vtxoBoardingAddress || ''
        if (!savingsAddress && !spendingAddress && !boardingAddress) {
          setVtxoSpendingSats(0)
          setVtxoMaxCoin(0)
          setBoardingBalance(0)
          setBoardingConfirmedBalance(0)
          setSavingsSats(0)
          setHistory([])
          return
        }
        if (savingsAddress) {
          const stats = await fetchAddressStats(savingsAddress)
          setSavingsSats(Math.max(0, stats.funded - stats.spent))
        } else {
          setSavingsSats(0)
        }
        if (spendingAddress && liveStatus?.enrolled) {
          const funds = await fetchVaultVtxoFunds(liveStatus)
          setVtxoSpendingSats(funds.balance)
          setVtxoMaxCoin(funds.maxCoin)
          setSpend((previous) => ({
            ...previous,
            fee:
              isVaultArkAddress(previous.address, liveStatus.network) && funds.maxCoin >= previous.amount + DUST_SATS
                ? 0
                : liveStatus.network === 'mutinynet'
                  ? liveFeeSats
                  : previous.fee,
          }))
        } else {
          setVtxoSpendingSats(0)
          setVtxoMaxCoin(0)
        }
        if (boardingAddress && liveStatus?.enrolled && liveStatus.vtxoBoardingActive) {
          const funds = await fetchVaultBoardingFunds(liveStatus)
          setBoardingBalance(funds.total)
          setBoardingConfirmedBalance(funds.confirmed)
        } else {
          setBoardingBalance(0)
          setBoardingConfirmedBalance(0)
        }
        const savingsTransactions = savingsAddress ? await fetchAddressTxs(savingsAddress).catch(() => []) : []
        const spendingHistory =
          spendingAddress && liveStatus?.enrolled ? await fetchVaultVtxoHistory(liveStatus).catch(() => []) : []
        setHistory([...historyFromTxs(savingsTransactions, savingsAddress, 'savings'), ...spendingHistory])
      } catch (error) {
        reportError(humanizeVaultError(error))
      }
    },
    [addressPin, liveFeeSats, reportError, setSpend, status],
  )

  const settleConfirmedBoarding = useCallback(async () => {
    if (boardingRun.current || !status?.enrolled || !enrollment) return
    if (!status.vtxoBoardingActive || !status.vtxoBoardingAddress) return
    const action = nextVaultBoardingAction({ confirmed: boardingConfirmedBalance, total: boardingBalance })
    if (action !== 'settle') return
    boardingRun.current = true
    reportError('')
    try {
      const settled = await withVaultBoardingLock(status.vaultId, async () => {
        setBoardingInProgress(true)
        const phoneSecret = await unlockPhoneBip340(enrollment, status)
        return withVaultBoardingSecret(phoneSecret, (liveSecret) => settleVaultBoarding(liveSecret, status))
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
    if (!status?.enrolled || !status.vaultId) return
    try {
      const result = await reconcilePersistedVtxoSpend(status)
      if (result.kind === 'receipt-finalized') await refreshBalance(status.vaultId)
    } catch (error) {
      consoleError(error, 'VTXO spend recovery')
    }
  }, [refreshBalance, status])

  useEffect(() => {
    if (locked || !status?.enrolled) return
    void recoverVtxoSpend()
    const pulse = () => {
      if (!status.vtxoBoardingActive || document.visibilityState === 'hidden') return
      void refreshBalance(status.vaultId)
      setBoardingPulse((value) => value + 1)
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
  }, [locked, recoverVtxoSpend, refreshBalance, status])

  return {
    boardingInProgress,
    history,
    refreshBalance,
    savingsSats,
    vtxoMaxCoin,
    vtxoSpendingSats,
  }
}

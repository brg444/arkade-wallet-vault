import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { consoleError } from '../lib/logs'
import { fetchAddressTxs, fetchAddressUtxos, type EsploraTx, type EsploraUtxo } from '../lib/vault/esplora'
import { historyFromTxs, type VaultHistoryItem } from '../lib/vault/history'
import { humanizeVaultError } from '../lib/vault/humanize'
import { loadAddressPin, requireStatusMatchesPin, type AddressPin } from '../lib/vault/pin'
import { fetchVaultStatus } from '../lib/vault/status'
import type { EnrollmentSecrets } from '../lib/vault/tenantEnrollment'
import type { VaultStatus } from '../lib/vault/types'
import {
  fetchVaultWalletVtxoSnapshot,
  reloadVaultWalletWorker,
  subscribeVaultWalletEvents,
} from '../lib/vault/vtxo/walletWorker'
import { reconcilePersistedVtxoSpend } from '../lib/vault/vtxo/spend'

interface VaultBalancesOptions {
  addressPin: AddressPin | null
  enrollment: EnrollmentSecrets | null
  initialStatusChecked: boolean
  locked: boolean
  setStatus: Dispatch<SetStateAction<VaultStatus | null>>
  status: VaultStatus | null
}

interface VaultBalanceSnapshot {
  boardingBalance: number
  history: VaultHistoryItem[]
  savingsSats: number
  savingsSpendableSats: number
  vtxoSpendingSats: number
}

const EMPTY_BALANCES: VaultBalanceSnapshot = {
  boardingBalance: 0,
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

// UI components consume the persistent SDK worker's balance and activity
// snapshots; they never own settlement, Operator, or indexer lifecycle.
export function useVaultBalances({
  addressPin,
  enrollment,
  initialStatusChecked,
  locked,
  setStatus,
  status,
}: VaultBalancesOptions) {
  const [snapshot, setSnapshot] = useState<VaultBalanceSnapshot>(EMPTY_BALANCES)
  const [balanceError, setBalanceError] = useState('')
  const [balancesLoaded, setBalancesLoaded] = useState(false)
  const [refreshingBalance, setRefreshingBalance] = useState(false)
  const refreshVersion = useRef(0)
  const statusRef = useRef(status)
  const addressPinRef = useRef(addressPin)
  const enrollmentRef = useRef(enrollment)
  statusRef.current = status
  addressPinRef.current = addressPin
  enrollmentRef.current = enrollment

  const refreshVaultId = status?.vaultId || enrollment?.vaultId || addressPin?.vaultId || ''

  const { boardingBalance, history, savingsSats, savingsSpendableSats, vtxoSpendingSats } = snapshot

  const refreshBalance = useCallback(
    async (vaultId?: string) => {
      const version = ++refreshVersion.current
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
        const [savings, spending] = await Promise.all([
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
            ? fetchVaultWalletVtxoSnapshot(liveStatus)
            : Promise.resolve({
                balance: 0,
                boardingBalance: undefined,
                history: [] as VaultHistoryItem[],
              }),
        ])
        if (version !== refreshVersion.current) return
        setStatus(liveStatus)
        setSnapshot({
          boardingBalance: spending.boardingBalance || 0,
          history: [...savings.history, ...spending.history],
          savingsSats: savings.balance,
          savingsSpendableSats: savings.spendable,
          vtxoSpendingSats: spending.balance,
        })
        setBalancesLoaded(true)
        setBalanceError('')
      } catch (error) {
        if (version === refreshVersion.current) {
          consoleError(error, 'Vault balance refresh')
          setBalanceError(humanizeVaultError(error))
        }
      } finally {
        if (version === refreshVersion.current) setRefreshingBalance(false)
      }
    },
    [setStatus],
  )

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
  }, [refreshVaultId])

  useEffect(() => {
    if (locked || !initialStatusChecked || !refreshVaultId) return
    void refreshBalance(refreshVaultId)
  }, [initialStatusChecked, locked, refreshBalance, refreshVaultId])

  useEffect(() => {
    if (locked || !status?.enrolled || !status.spendingArkAddress) return
    let timer = 0
    const unsubscribe = subscribeVaultWalletEvents(status, () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void refreshBalance(status.vaultId), 200)
    })
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [locked, refreshBalance, status])

  useEffect(() => {
    if (locked || !initialStatusChecked || !refreshVaultId) return
    if (status?.enrolled) void recoverVtxoSpend()
    const onFocus = () => {
      if (status?.enrolled) void recoverVtxoSpend()
      if (status?.enrolled) {
        void reloadVaultWalletWorker(status)
          .catch((error) => consoleError(error, 'wallet VTXO worker reload'))
          .finally(() => void refreshBalance(refreshVaultId))
      } else {
        void refreshBalance(refreshVaultId)
      }
    }
    const onOnline = () => onFocus()
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [initialStatusChecked, locked, recoverVtxoSpend, refreshBalance, refreshVaultId, status?.enrolled])

  useEffect(
    () => () => {
      refreshVersion.current += 1
    },
    [],
  )

  return {
    balanceError,
    balancesLoaded,
    boardingBalance,
    history,
    refreshBalance,
    refreshingBalance,
    savingsSats,
    savingsSpendableSats,
    vtxoSpendingSats,
  }
}

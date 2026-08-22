import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DUST_SATS } from '../lib/vault/constants'
import { reconcileStagedEnrollment, type EnrollmentSecrets } from '../lib/vault/tenantEnrollment'
import {
  findStoredEnrollment,
  loadEnrollment,
  loadSelectedVaultId,
  loadSessionLocked,
  saveSelectedVaultId,
  setSessionLocked,
} from '../lib/vault/enrollmentStore'
import { loadAddressPin, type AddressPin } from '../lib/vault/pin'
import { zeroBytes } from '../lib/vault/ceremony/directauth.js'
import { broadcastTx, confirmedSpendables, fetchAddressUtxos } from '../lib/vault/esplora'
import type { VaultHistoryItem } from '../lib/vault/history'
import {
  buildSavingsPsbt,
  finalizeSavingsPsbt,
  parseIncomingPsbt,
  requireSameSavingsIntent,
  signSavingsPsbt,
  unlockPhoneRoutine,
} from '../lib/vault/savingsSpend'
import { humanizeVaultError } from '../lib/vault/humanize'
import { isVaultArkAddress, isVaultSpendAddress } from '../lib/vault/bitcoin'
import { isVtxoReceiptPendingError, isVtxoSpendInFlightError, sendVaultVtxo } from '../lib/vault/vtxo/spend'
import { verifyVaultBoarding } from '../lib/vault/vtxo/board'
import { fetchPublicStatus, fetchVaultStatus, type PublicAuthorizerStatus } from '../lib/vault/status'
import {
  clearSetupPlan,
  emptySetupPlan,
  loadSetupPlan,
  parseCompressedPub,
  planReady,
  saveSetupPlan,
  sameRole,
  type VaultSetupPlan,
} from '../lib/vault/setupPlan'

import type { VaultStatus } from '../lib/vault/types'
import {
  DEFAULT_SPEND_FEE_SATS,
  VaultContext,
  type VaultAccount,
  type VaultContextProps,
  type VaultScreen,
  type VaultSpend,
} from '../vault/context'
import { useRecoveryKit } from '../vault/useRecoveryKit'
import { useVaultBalances } from '../vault/useVaultBalances'
import { useVaultSession } from '../vault/useVaultSession'

export { VaultContext } from '../vault/context'
export type { VaultAccount, VaultContextProps, VaultScreen, VaultSpend } from '../vault/context'

const DEFAULT_FEE = DEFAULT_SPEND_FEE_SATS
const LIVE_FEE = 1500

export function VaultProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<VaultScreen>('welcome')
  const [recoverEntry, setRecoverEntry] = useState<'kit' | 'lost'>('kit')
  const [recoverExit, setRecoverExit] = useState<VaultScreen>('keys')
  const [setup, setSetup] = useState<VaultSetupPlan>(emptySetupPlan)
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [deployment, setDeployment] = useState<PublicAuthorizerStatus | null>(null)
  const [enrollment, setEnrollment] = useState<EnrollmentSecrets | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [spend, setSpend] = useState<VaultSpend>({ address: '', amount: 0, fee: DEFAULT_FEE })
  const [lastSend, setLastSend] = useState<VaultSpend | null>(null)
  const [lastTxid, setLastTxid] = useState('')
  const [lastTxKind, setLastTxKind] = useState<'onchain' | 'vtxo' | ''>('')
  const [selectedTx, setSelectedTx] = useState<VaultHistoryItem | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [account, setAccount] = useState<VaultAccount>('spend')
  const [scanOnSend, setScanOnSend] = useState(false)
  const [handoffPsbt, setHandoffPsbt] = useState('')
  const [locked, setLocked] = useState(false)
  const [addressPin, setAddressPin] = useState<AddressPin | null>(null)

  useEffect(() => {
    let existing: EnrollmentSecrets | null = null
    try {
      const plan = loadSetupPlan()
      if (plan) {
        setSetup(plan)
        if (plan.complete) {
          setScreen('passkey')
        }
      }
      const selected = loadSelectedVaultId()
      existing = selected ? loadEnrollment(localStorage, selected) : findStoredEnrollment()
      if (existing?.vaultId) saveSelectedVaultId(existing.vaultId)
      const pinId = existing?.vaultId || selected
      setAddressPin(pinId ? loadAddressPin(localStorage, pinId) : null)
      const sessionLocked = loadSessionLocked()
      setLocked(sessionLocked)
      if (existing) setEnrollment(existing)
      if (existing && !sessionLocked) setScreen('home')
    } catch {
      clearSetupPlan()
    } finally {
      setLoaded(true)
    }
    const selectedId = existing?.vaultId || loadSelectedVaultId()
    const boot = async () => {
      try {
        const recovered = await reconcileStagedEnrollment()
        if (recovered && !loadSessionLocked()) {
          setEnrollment(recovered.enrollment)
          setStatus(recovered.status)
          setAddressPin(loadAddressPin(localStorage, recovered.status.vaultId))
          setScreen('home')
          return
        }
        if (selectedId) {
          const live = await fetchVaultStatus(undefined, selectedId)
          setStatus(live)
          setAddressPin(loadAddressPin(localStorage, live.vaultId))
        } else {
          setDeployment(await fetchPublicStatus())
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('local pin') || msg.includes('not pinned locally')) {
          setError(humanizeVaultError(err))
        }
      }
    }
    void boot()
  }, [])

  useEffect(() => {
    if (!status || status.network !== 'mutinynet') return
    setSpend((prev) => (prev.fee === DEFAULT_FEE ? { ...prev, fee: LIVE_FEE } : prev))
    setSetup((prev) => {
      const next = {
        ...prev,
        txCapSats: status.txCap || prev.txCapSats,
        dailyLimitSats: status.periodAllowance || prev.dailyLimitSats,
        operationalCsvBlocks: status.operationalCsvBlocks || prev.operationalCsvBlocks,
        savingsCsvBlocks: status.savingsCsvBlocks || prev.savingsCsvBlocks,
      }
      if (
        next.txCapSats === prev.txCapSats &&
        next.dailyLimitSats === prev.dailyLimitSats &&
        next.operationalCsvBlocks === prev.operationalCsvBlocks &&
        next.savingsCsvBlocks === prev.savingsCsvBlocks
      ) {
        return prev
      }
      saveSetupPlan(next)
      return next
    })
  }, [status])

  const persist = useCallback((next: VaultSetupPlan) => {
    setSetup(next)
    saveSetupPlan(next)
    return next
  }, [])

  const operationalAddress = addressPin?.operationalAddress || ''
  const spendingArkAddress = status?.spendingArkAddress || ''
  const boardingAddress = status?.vtxoBoardingAddress || ''
  const savingsAddress = addressPin?.savingsAddress || ''
  const liveNetwork = (status?.network || deployment?.network) === 'mutinynet'
  const reportError = useCallback((message: string) => setError(message), [])
  const onBoarded = useCallback((txid: string) => {
    setLastTxid(txid)
    setLastTxKind('vtxo')
  }, [])
  const {
    boardingInProgress,
    history,
    onchainSpendingSats,
    refreshBalance,
    savingsSats,
    vtxoMaxCoin,
    vtxoSpendingSats,
  } = useVaultBalances({
    addressPin,
    busy,
    enrollment,
    liveFeeSats: LIVE_FEE,
    locked,
    onBoarded,
    reportError,
    setSpend,
    status,
  })
  const dailyLimit = status?.enrolled ? (status.periodAllowance ?? setup.dailyLimitSats) : setup.dailyLimitSats
  const dailyRemaining = status?.enrolled ? (status.periodRemaining ?? dailyLimit) : 0
  const amountSats = status?.enrolled ? vtxoSpendingSats : 0
  const enrolled = Boolean(status?.enrolled)
  const networkLabel = liveNetwork ? 'Mutinynet' : 'Test network'
  const clearError = useCallback(() => reportError(''), [reportError])
  const {
    backupRecoveryKit,
    downloadRecoveryKit,
    hasRecoveryKit,
    initiateAlert,
    initiateAlerts,
    restoreRecoveryKit,
    signGuardianExitWithDevice,
  } = useRecoveryKit({
    enrollment,
    status,
    hardwarePub: setup.hardwarePub,
    recoveryPub: setup.recoveryPub,
    clearError,
  })

  const acceptDesign = useCallback(() => {
    persist({ ...setup, acceptedDesign: true })
    setError('')
    setScreen('hardware')
  }, [persist, setup])

  const applyHardware = useCallback(
    (raw: string) => {
      setError('')
      try {
        const hardwarePub = parseCompressedPub(raw, 'hardware key')
        if (status?.externalOwnerWalletPub && hardwarePub !== status.externalOwnerWalletPub) {
          throw new Error('This Mutinynet vault requires the hardware key already configured on the service')
        }
        persist({ ...setup, hardwarePub })
        setScreen('recovery')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [persist, setup, status?.externalOwnerWalletPub],
  )

  const applyRecovery = useCallback(
    (raw: string) => {
      setError('')
      try {
        const recoveryPub = parseCompressedPub(raw, 'recovery key')
        if (!setup.hardwarePub) throw new Error('Set hardware first')
        if (sameRole(recoveryPub, setup.hardwarePub)) throw new Error('Recovery must be a different key')
        persist({ ...setup, recoveryPub })
        setScreen('conditions')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [persist, setup],
  )

  const skipRecovery = useCallback(() => {
    setError('')
    persist({ ...setup, recoveryPub: '' })
    setScreen('conditions')
  }, [persist, setup])

  const confirmConditions = useCallback(() => {
    setError('')
    setScreen('plan')
  }, [])

  const finishPlan = useCallback(() => {
    setError('')
    if (!planReady(setup)) {
      setError('Finish setup first.')
      return
    }
    setScreen('passkey')
  }, [setup])

  const sealPlan = useCallback(() => {
    const next = persist({ ...setup, complete: true })
    return next
  }, [persist, setup])

  const { enableOtherDevices, enroll, signIn } = useVaultSession({
    enrollment,
    refreshBalance,
    reportError,
    sealPlan,
    setAddressPin,
    setBusy,
    setEnrollment,
    setLocked,
    setScreen,
    setStatus,
    setup,
    status,
  })

  const setSpendDraft = useCallback(
    (draft: Partial<VaultSpend>) => {
      setSpend((prev) => {
        const next = { ...prev, ...draft }
        if (account === 'spend' && status?.enrolled) {
          next.fee =
            isVaultArkAddress(next.address, status.network) && vtxoMaxCoin >= next.amount + DUST_SATS
              ? 0
              : liveNetwork
                ? LIVE_FEE
                : next.fee
        }
        return next
      })
      setError('')
    },
    [account, liveNetwork, status?.enrolled, status?.network, vtxoMaxCoin],
  )

  const reviewSpend = useCallback(() => {
    setError('')
    if (!status?.enrolled) {
      setError('Unlock this vault before sending.')
      return
    }
    const destNetwork = status.network
    if (!isVaultSpendAddress(spend.address, destNetwork)) {
      setError('Enter an Arkade or Bitcoin address.')
      return
    }
    if (!Number.isInteger(spend.amount) || spend.amount < DUST_SATS) {
      setError('At least 330 sats.')
      return
    }
    const arkDestination = isVaultArkAddress(spend.address, destNetwork)
    if (arkDestination && account === 'savings') {
      setError('Savings sends require a Bitcoin address.')
      return
    }
    if (!arkDestination && account === 'spend' && status?.enrolled) {
      setError('Spending currently sends VTXOs to Arkade addresses. Bitcoin withdrawal is not in this rollout yet.')
      return
    }
    if (arkDestination && vtxoMaxCoin < spend.amount + DUST_SATS) {
      setError('An Arkade destination requires one VTXO large enough for the payment and change.')
      return
    }
    const source = account === 'savings' ? savingsSats : vtxoMaxCoin
    if (account !== 'savings') {
      if (spend.amount > setup.txCapSats) {
        setError(`Over this device’s send limit of ${setup.txCapSats.toLocaleString()} sats. Use Savings.`)
        return
      }
      if (spend.amount + spend.fee > dailyRemaining) {
        setError('Over today’s limit. Wait, or send from Savings.')
        return
      }
    }
    if (spend.amount + spend.fee > source) {
      if (
        account !== 'savings' &&
        arkDestination &&
        spend.amount + spend.fee <= vtxoSpendingSats &&
        vtxoMaxCoin < spend.amount + DUST_SATS
      ) {
        setError('This first VTXO release spends one VTXO at a time. Choose a smaller amount.')
        return
      }
      setError(
        account === 'savings'
          ? 'Not enough confirmed savings.'
          : arkDestination
            ? 'Leave 330 sats of change.'
            : 'Not enough confirmed spending funds.',
      )
      return
    }
    if (account !== 'savings' && spend.amount + spend.fee + DUST_SATS > source) {
      setError('Leave 330 sats of change.')
      return
    }
    if (account === 'savings' && spend.amount + spend.fee < source && source - (spend.amount + spend.fee) < DUST_SATS) {
      setError('Leave 330 sats of change, or send the rest.')
      return
    }
    setScreen('review')
  }, [
    account,
    dailyRemaining,
    savingsSats,
    setup.txCapSats,
    spend,
    status?.network,
    status?.enrolled,
    vtxoSpendingSats,
    vtxoMaxCoin,
  ])

  const finishBroadcast = useCallback(
    async (txid: string, kind: 'onchain' | 'vtxo' = 'onchain') => {
      setLastTxid(txid)
      setLastTxKind(kind)
      setLastSend(spend)
      setSpend({ address: '', amount: 0, fee: liveNetwork ? LIVE_FEE : DEFAULT_FEE })
      setHandoffPsbt('')
      if (status?.vaultId) await refreshBalance(status.vaultId)
      if (enrollment?.vaultId) {
        const live = await fetchVaultStatus(undefined, enrollment.vaultId)
        setStatus(live)
        if (live.vaultId) setAddressPin(loadAddressPin(localStorage, live.vaultId))
      }
      setScreen('success')
    },
    [enrollment, liveNetwork, refreshBalance, spend, status],
  )

  const approveSavingsSend = useCallback(async () => {
    if (!status?.enrolled || !enrollment || !savingsAddress) {
      throw new Error('Sign in with the passkey that created this vault.')
    }
    const need = spend.amount + spend.fee
    const utxos = await fetchAddressUtxos(savingsAddress)
    const coins = confirmedSpendables(utxos, need)
    if (coins.length === 0) throw new Error('Confirmed Savings funds do not cover this transfer.')
    const leaf = 'admin' as const
    if (spend.address === status.vtxoBoardingAddress) await verifyVaultBoarding(status)
    const unsigned = buildSavingsPsbt({
      status,
      phonePub: enrollment.phoneRoutineBip340Pub,
      destAddress: spend.address,
      amountSats: spend.amount,
      feeSats: spend.fee,
      coins: coins.map((coin) => ({
        txid: coin.txid,
        vout: coin.vout,
        value: coin.value,
        confirmedHeight: coin.status.block_height,
      })),
      leaf,
    })
    const secret = await unlockPhoneRoutine(enrollment, status)
    try {
      const signed = signSavingsPsbt(unsigned, secret)
      setHandoffPsbt(signed)
      setScreen('handoff')
    } finally {
      zeroBytes(secret)
    }
  }, [enrollment, finishBroadcast, savingsAddress, spend, status])

  const completeSavingsHandoff = useCallback(
    async (signedPsbt: string) => {
      setBusy(true)
      setError('')
      try {
        if (!handoffPsbt) throw new Error('create the device signature first')
        const incoming = parseIncomingPsbt(signedPsbt)
        requireSameSavingsIntent(handoffPsbt, incoming, spend.address, spend.amount, status?.network || 'mutinynet')
        const final = finalizeSavingsPsbt(incoming)
        const txid = await broadcastTx(final.txHex)
        await finishBroadcast(txid)
      } catch (err) {
        setError(humanizeVaultError(err))
      } finally {
        setBusy(false)
      }
    },
    [finishBroadcast, handoffPsbt, spend, status?.network],
  )

  const approveSend = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      if (account === 'savings') {
        await approveSavingsSend()
        return
      }
      if (!status?.enrolled || !enrollment) {
        setError('Sign in with the passkey that created this vault.')
        return
      }
      if (!spendingArkAddress) {
        setError('No spending address yet.')
        return
      }
      if (
        spendingArkAddress &&
        isVaultArkAddress(spend.address, status.network) &&
        vtxoMaxCoin >= spend.amount + DUST_SATS
      ) {
        if (boardingInProgress) {
          setError('Spending is still boarding Bitcoin. Try again in a moment.')
          return
        }
        try {
          const result = await sendVaultVtxo(enrollment, status, spend.address, spend.amount)
          await finishBroadcast(result.txid, 'vtxo')
          return
        } catch (err) {
          if (isVtxoReceiptPendingError(err)) {
            await finishBroadcast(err.txid, 'vtxo')
            return
          }
          if (status.vaultId) await refreshBalance(status.vaultId)
          if (isVtxoSpendInFlightError(err)) {
            setError(humanizeVaultError(err))
            setScreen('home')
            return
          }
          throw err
        }
      }
      setError('Vault isn’t ready to send.')
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [
    account,
    approveSavingsSend,
    boardingInProgress,
    enrollment,
    finishBroadcast,
    refreshBalance,
    spend,
    spendingArkAddress,
    status,
    vtxoMaxCoin,
  ])

  const reset = useCallback(() => {
    setSessionLocked(true)
    setLocked(true)
    setError('')
    setSpend({ address: '', amount: 0, fee: liveNetwork ? LIVE_FEE : DEFAULT_FEE })
    setLastSend(null)
    setLastTxid('')
    setLastTxKind('')
    setAccount('spend')
    setScanOnSend(false)
    setHandoffPsbt('')
    setScreen('welcome')
  }, [liveNetwork])

  const value = useMemo<VaultContextProps>(
    () => ({
      acceptDesign,
      account,
      amountSats,
      applyHardware,
      applyRecovery,
      skipRecovery,
      downloadRecoveryKit,
      backupRecoveryKit,
      boardingAddress,
      boardingInProgress,
      restoreRecoveryKit,
      signGuardianExitWithDevice,
      hasRecoveryKit,
      initiateAlert,
      initiateAlerts,
      approveSend,
      busy,
      canSend: vtxoMaxCoin > DUST_SATS + spend.fee,
      completeSavingsHandoff,
      handoffPsbt,
      confirmConditions,
      dailyLimit,
      dailyRemaining,
      dailySpent: status?.enrolled ? (status.periodSpent ?? 0) : Math.max(0, dailyLimit - dailyRemaining),
      enablePasskeyLogin: enableOtherDevices,
      enroll,
      enrolled,
      error,
      finishPlan,
      hasLocalEnrollment: Boolean(enrollment),
      locked,
      lastTxid,
      lastTxKind,
      history: history.filter((item) => item.account === account),
      selectedTx,
      openTx: (tx) => {
        setSelectedTx(tx)
        setError('')
        setScreen('tx')
      },
      liveNetwork,
      navigate: (next) => {
        setError('')
        setScreen(next)
      },
      openRecover: (view = 'kit', exit = 'keys') => {
        setError('')
        setRecoverEntry(view)
        setRecoverExit(exit)
        setScreen('recover')
      },
      recoverEntry,
      recoverExit,
      networkLabel,
      operationalAddress,
      onchainSpendingSats,
      spendingArkAddress,
      refreshBalance,
      reset,
      reviewSpend,
      openSendScan: () => {
        setAccount('spend')
        setScanOnSend(true)
        setError('')
        setScreen('send')
      },
      scanOnSend,
      clearSendScan: () => setScanOnSend(false),
      savingsAddress,
      savingsSats,
      screen: loaded ? screen : 'welcome',
      setAccount,
      setSpendDraft,
      setup,
      signIn,
      spend,
      status,
      lastSend,
      vtxoSpendingSats,
    }),
    [
      acceptDesign,
      account,
      amountSats,
      onchainSpendingSats,
      applyHardware,
      applyRecovery,
      skipRecovery,
      downloadRecoveryKit,
      backupRecoveryKit,
      boardingAddress,
      boardingInProgress,
      restoreRecoveryKit,
      signGuardianExitWithDevice,
      hasRecoveryKit,
      initiateAlert,
      initiateAlerts,
      approveSend,
      busy,
      completeSavingsHandoff,
      confirmConditions,
      handoffPsbt,
      dailyLimit,
      dailyRemaining,
      enableOtherDevices,
      enrollment,
      enroll,
      signIn,
      enrolled,
      error,
      finishPlan,
      lastTxid,
      lastTxKind,
      history,
      selectedTx,
      liveNetwork,
      locked,
      lastSend,
      recoverEntry,
      recoverExit,
      loaded,
      networkLabel,
      operationalAddress,
      spendingArkAddress,
      recoverEntry,
      recoverExit,
      refreshBalance,
      reset,
      reviewSpend,
      scanOnSend,
      savingsAddress,
      savingsSats,
      screen,
      setSpendDraft,
      setup,
      spend,
      status?.enrolled,
      status?.periodSpent,
      vtxoSpendingSats,
      vtxoMaxCoin,
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

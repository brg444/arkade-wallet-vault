import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DUST_SATS } from '../lib/vault/constants'
import { enrollWithPasskey, reconcileStagedEnrollment, type EnrollmentSecrets } from '../lib/vault/tenantEnrollment'
import {
  discoverVaultIdFromPasskey,
  enablePasskeyLogin,
  signInWithPasskey,
  unlockLocalEnrollment,
} from '../lib/vault/signIn'
import {
  findStoredEnrollment,
  loadEnrollment,
  loadSelectedVaultId,
  loadSessionLocked,
  saveEnrollment,
  saveSelectedVaultId,
  setSessionLocked,
} from '../lib/vault/enrollmentStore'
import { loadAddressPin, type AddressPin } from '../lib/vault/pin'
import { zeroBytes } from '../lib/vault/ceremony/directauth.js'
import {
  broadcastTx,
  confirmedSpendable,
  fetchAddressStats,
  fetchAddressTxs,
  fetchAddressUtxos,
  fetchTipHeight,
} from '../lib/vault/esplora'
import { historyFromTxs, type VaultHistoryItem } from '../lib/vault/history'
import { consoleError } from '../lib/logs'
import {
  buildSavingsPsbt,
  chooseSavingsLeafForStatus,
  finalizeSavingsPsbt,
  parseHardwareSecret,
  parseIncomingPsbt,
  requireSameSavingsIntent,
  signSavingsPsbt,
  unlockPhoneRoutine,
} from '../lib/vault/savingsSpend'
import { humanizeVaultError } from '../lib/vault/humanize'
import { isVaultArkAddress, isVaultSpendAddress } from '../lib/vault/bitcoin'
import {
  fetchVaultVtxoFunds,
  fetchVaultVtxoHistory,
  isVtxoReceiptPendingError,
  isVtxoSpendInFlightError,
  reconcilePersistedVtxoSpend,
  sendVaultVtxo,
} from '../lib/vault/vtxo/spend'
import {
  boardingAttemptKeyAfterLock,
  boardingFailureHold,
  fetchVaultBoardingFunds,
  nextVaultBoardingAction,
  settleVaultBoarding,
  verifyVaultBoarding,
  withVaultBoardingLock,
  withVaultBoardingSecret,
} from '../lib/vault/vtxo/board'
import { fetchVaultStatus } from '../lib/vault/status'
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

import {
  kitFromFacts,
  pullMapBackup,
  pushMapBackup,
  unwrapMapWithHardware,
  wrapMapForHardware,
  type HardwareMapWrap,
} from '../lib/vault/v5/kitBackup'

import { signGuardianExitPsbt } from '../lib/vault/v5/guardianExit'
import { loadLocalKit, saveLocalKit } from '../lib/vault/v5/kitStore'
import { kitMatchesLiveVault, selectLiveKit } from '../lib/vault/v5/liveKit'
import {
  alertCopy,
  loadSeenOutpoints,
  pollPendingInitiates,
  saveSeenOutpoints,
  type InitiateAlert,
} from '../lib/vault/v5/watch'
import type { VaultStatus } from '../lib/vault/types'
import {
  DEFAULT_SPEND_FEE_SATS,
  VaultContext,
  type VaultAccount,
  type VaultContextProps,
  type VaultScreen,
  type VaultSpend,
} from '../vault/context'

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
  const [enrollment, setEnrollment] = useState<EnrollmentSecrets | null>(null)
  const [initiateAlert, setInitiateAlert] = useState('')
  const [initiateAlerts, setInitiateAlerts] = useState<InitiateAlert[]>([])

  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [spend, setSpend] = useState<VaultSpend>({ address: '', amount: 0, fee: DEFAULT_FEE })
  const [lastSend, setLastSend] = useState<VaultSpend | null>(null)
  const [lastTxid, setLastTxid] = useState('')
  const [lastTxKind, setLastTxKind] = useState<'onchain' | 'vtxo' | ''>('')
  const [history, setHistory] = useState<VaultHistoryItem[]>([])
  const [selectedTx, setSelectedTx] = useState<VaultHistoryItem | null>(null)
  const [chainBalance, setChainBalance] = useState(0)
  const [vtxoBalance, setVtxoBalance] = useState(0)
  const [vtxoMaxCoin, setVtxoMaxCoin] = useState(0)
  const [boardingBalance, setBoardingBalance] = useState(0)
  const [boardingConfirmedBalance, setBoardingConfirmedBalance] = useState(0)
  const [boardingInProgress, setBoardingInProgress] = useState(false)
  const [boardingPulse, setBoardingPulse] = useState(0)
  const [savingsBalance, setSavingsBalance] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [account, setAccount] = useState<VaultAccount>('spend')
  const [scanOnSend, setScanOnSend] = useState(false)
  const [handoffPsbt, setHandoffPsbt] = useState('')
  const [locked, setLocked] = useState(false)
  const [addressPin, setAddressPin] = useState<AddressPin | null>(null)
  const boardingRun = useRef(false)
  const boardingAttempt = useRef('')
  const boardingRetryAfter = useRef(0)

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
        const live = selectedId ? await fetchVaultStatus(undefined, selectedId) : await fetchVaultStatus()
        setStatus(live)
        if (live.vaultId) setAddressPin(loadAddressPin(localStorage, live.vaultId))
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
  const liveNetwork = status?.network === 'mutinynet'
  const dailyLimit = status?.enrolled ? (status.periodAllowance ?? setup.dailyLimitSats) : setup.dailyLimitSats
  const dailyRemaining = status?.enrolled ? (status.periodRemaining ?? dailyLimit) : 0
  const amountSats = status?.enrolled ? vtxoBalance : 0
  const enrolled = Boolean(status?.enrolled)
  const networkLabel = liveNetwork ? 'Mutinynet' : 'Test network'

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
        persist({ ...setup, hardwarePub, hardwareIsDemo: false })
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
        persist({ ...setup, recoveryPub, recoveryIsDemo: false })
        setScreen('conditions')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [persist, setup],
  )

  const skipRecovery = useCallback(() => {
    setError('')
    persist({ ...setup, recoveryPub: '', recoveryIsDemo: false })
    setScreen('conditions')
  }, [persist, setup])

  const setCondition = useCallback(
    (
      patch: Partial<
        Pick<VaultSetupPlan, 'txCapSats' | 'dailyLimitSats' | 'operationalCsvBlocks' | 'savingsCsvBlocks'>
      >,
    ) => {
      persist({ ...setup, ...patch })
    },
    [persist, setup],
  )

  const confirmConditions = useCallback(() => {
    setError('')
    if (setup.txCapSats > setup.dailyLimitSats) {
      setError('Daily limit must be at least one payment.')
      return
    }
    setScreen('plan')
  }, [setup])

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

  const resolveKit = useCallback(() => {
    const id = status?.vaultId || enrollment?.vaultId || ''
    const template = String(status?.templateVersion || '')
    const stored = id ? loadLocalKit(id) : null
    if (status?.enrolled) {
      if (stored && kitMatchesLiveVault(stored, id, template)) return stored
      return kitFromFacts({
        enrollment,
        status,
        hardwarePub: setup.hardwarePub,
        recoveryPub: setup.recoveryPub || status?.recoveryPub,
      })
    }
    return kitFromFacts({
      enrollment,
      status,
      hardwarePub: setup.hardwarePub,
      recoveryPub: setup.recoveryPub || status?.recoveryPub,
    })
  }, [enrollment, setup.hardwarePub, setup.recoveryPub, status])

  const downloadRecoveryKit = useCallback(() => {
    const kit = resolveKit()
    if (!kit) throw new Error('No Recovery Kit yet. Add recovery, or get the map with Face ID.')
    return JSON.stringify(kit, null, 2)
  }, [resolveKit])

  const backupRecoveryKit = useCallback(async () => {
    setError('')
    if (enrollment && status?.enrolled) await unlockLocalEnrollment(enrollment)
    const kit = resolveKit()
    if (!kit) throw new Error('This vault has no recovery map. Add recovery on a new vault.')
    saveLocalKit(kit)
    const id = kit.descriptor.vaultId
    const hardwarePub = setup.hardwarePub || status?.externalOwnerWalletPub || ''
    const wrap = hardwarePub ? await wrapMapForHardware(kit, hardwarePub) : undefined
    return id ? pushMapBackup(id, kit, wrap) : false
  }, [enrollment, resolveKit, setup.hardwarePub, status?.enrolled, status?.externalOwnerWalletPub])

  const restoreRecoveryKit = useCallback(async () => {
    setError('')
    if (enrollment && status?.enrolled) await unlockLocalEnrollment(enrollment)
    const id = status?.vaultId || enrollment?.vaultId || ''
    const pulled = id ? await pullMapBackup(id) : null
    const kit =
      pulled?.kit ||
      kitFromFacts({
        enrollment,
        status,
        hardwarePub: setup.hardwarePub,
        recoveryPub: setup.recoveryPub || status?.recoveryPub,
      })
    if (!kit) throw new Error('Could not rebuild the map. Save it while this app is open.')
    if (id && kit.descriptor.vaultId !== id) throw new Error('Recovery Kit does not match this vault')
    if (status?.enrolled && status.templateVersion && kit.descriptor.templateVersion !== status.templateVersion) {
      throw new Error('Recovery Kit does not match this vault')
    }
    saveLocalKit(kit)
  }, [enrollment, setup.hardwarePub, setup.recoveryPub, status])

  const unlockMapWithHardware = useCallback(async (wrapRaw: string, hardwareSecret: string) => {
    setError('')
    let priv: Uint8Array | undefined
    try {
      priv = parseHardwareSecret(hardwareSecret)
      const wrap = JSON.parse(wrapRaw) as HardwareMapWrap
      const kit = await unwrapMapWithHardware(wrap, priv)
      saveLocalKit(kit)
    } finally {
      priv?.fill(0)
    }
  }, [])

  const signGuardianExitWithDevice = useCallback(
    async (psbtHex: string) => {
      if (!enrollment || !status?.enrolled) throw new Error('Unlock this device on this vault first')
      const priv = await unlockPhoneRoutine(enrollment, status)
      try {
        return signGuardianExitPsbt(psbtHex, priv)
      } finally {
        zeroBytes(priv)
      }
    },
    [enrollment, status],
  )

  const refreshBalance = useCallback(
    async (vaultId?: string) => {
      const id = String(vaultId || status?.vaultId || addressPin?.vaultId || '').trim()
      const pin = id ? loadAddressPin(localStorage, id) : null
      const address = pin?.operationalAddress || ''
      const savings = pin?.savingsAddress || ''
      try {
        const liveStatus = id && status?.vaultId !== id ? await fetchVaultStatus(undefined, id) : status
        const arkAddress = liveStatus?.spendingArkAddress || ''
        const boardAddress = liveStatus?.vtxoBoardingAddress || ''
        if (!address && !savings && !arkAddress && !boardAddress) {
          setChainBalance(0)
          setVtxoBalance(0)
          setVtxoMaxCoin(0)
          setBoardingBalance(0)
          setBoardingConfirmedBalance(0)
          setSavingsBalance(0)
          setHistory([])
          return
        }
        if (address) {
          const stats = await fetchAddressStats(address)
          setChainBalance(Math.max(0, stats.funded - stats.spent))
        } else {
          setChainBalance(0)
        }
        if (savings) {
          const stats = await fetchAddressStats(savings)
          setSavingsBalance(Math.max(0, stats.funded - stats.spent))
        } else {
          setSavingsBalance(0)
        }
        if (arkAddress && liveStatus?.enrolled) {
          const funds = await fetchVaultVtxoFunds(liveStatus)
          setVtxoBalance(funds.balance)
          setVtxoMaxCoin(funds.maxCoin)
          setSpend((prev) => ({
            ...prev,
            fee:
              isVaultArkAddress(prev.address, liveStatus.network) && funds.maxCoin >= prev.amount + DUST_SATS
                ? 0
                : liveStatus.network === 'mutinynet'
                  ? LIVE_FEE
                  : prev.fee,
          }))
        } else {
          setVtxoBalance(0)
          setVtxoMaxCoin(0)
        }
        if (boardAddress && liveStatus?.enrolled && liveStatus.vtxoBoardingActive) {
          const funds = await fetchVaultBoardingFunds(liveStatus)
          setBoardingBalance(funds.total)
          setBoardingConfirmedBalance(funds.confirmed)
        } else {
          setBoardingBalance(0)
          setBoardingConfirmedBalance(0)
        }
        const savTxs = savings ? await fetchAddressTxs(savings).catch(() => []) : []
        const vtxoHistory =
          arkAddress && liveStatus?.enrolled ? await fetchVaultVtxoHistory(liveStatus).catch(() => []) : []
        setHistory([...historyFromTxs(savTxs, savings, 'savings'), ...vtxoHistory])
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [addressPin, status],
  )

  const reconcileSpendingToVtxos = useCallback(async () => {
    if (boardingRun.current || !status?.enrolled || !enrollment) return
    if (!status.vtxoBoardingActive || !status.vtxoBoardingAddress) return
    const action = nextVaultBoardingAction({
      confirmed: boardingConfirmedBalance,
      total: boardingBalance,
    })
    if (action !== 'settle') return
    boardingRun.current = true
    setError('')
    try {
      const settled = await withVaultBoardingLock(status.vaultId, async () => {
        setBoardingInProgress(true)
        const phoneSecret = await unlockPhoneRoutine(enrollment, status)
        return withVaultBoardingSecret(phoneSecret, (liveSecret) => settleVaultBoarding(liveSecret, status))
      })
      if (!settled.held) {
        boardingAttempt.current = boardingAttemptKeyAfterLock(false, '')
        return
      }
      boardingAttempt.current = `${status.vaultId}:settle:${boardingConfirmedBalance}:${boardingBalance}`
      setLastTxid(settled.value.txid)
      setLastTxKind('vtxo')
      boardingRetryAfter.current = 0
      await refreshBalance(status.vaultId)
    } catch (err) {
      consoleError(err, 'automatic Spending transfer')
      setError('')
      const hold = boardingFailureHold(err, `${status.vaultId}:settle:${boardingConfirmedBalance}:${boardingBalance}`)
      boardingAttempt.current = hold.attemptKey
      boardingRetryAfter.current = Date.now() + hold.retryDelayMs
      await refreshBalance(status.vaultId)
    } finally {
      boardingRun.current = false
      setBoardingInProgress(false)
    }
  }, [boardingBalance, boardingConfirmedBalance, enrollment, refreshBalance, status])

  useEffect(() => {
    if (busy || boardingInProgress || locked || !enrollment || !status?.enrolled || !status.vtxoBoardingActive) return
    const action = nextVaultBoardingAction({
      confirmed: boardingConfirmedBalance,
      total: boardingBalance,
    })
    if (action === 'idle' || action === 'wait') {
      boardingAttempt.current = ''
      return
    }
    if (Date.now() < boardingRetryAfter.current) return
    const key = `${status.vaultId}:${action}:${boardingConfirmedBalance}:${boardingBalance}`
    if (boardingAttempt.current === key) return
    void reconcileSpendingToVtxos()
  }, [
    boardingBalance,
    boardingConfirmedBalance,
    boardingInProgress,
    boardingPulse,
    busy,
    enrollment,
    locked,
    reconcileSpendingToVtxos,
    status,
  ])

  const recoverVtxoSpend = useCallback(async () => {
    if (!status?.enrolled || !status.vaultId) return
    try {
      const result = await reconcilePersistedVtxoSpend(status)
      if (result.kind === 'receipt-finalized') await refreshBalance(status.vaultId)
    } catch (err) {
      consoleError(err, 'VTXO spend recovery')
    }
  }, [refreshBalance, status])

  useEffect(() => {
    if (locked || !status?.enrolled) return
    void recoverVtxoSpend()
    const pulse = () => {
      if (!status.vtxoBoardingActive) return
      if (document.visibilityState !== 'hidden') {
        void refreshBalance(status.vaultId)
        setBoardingPulse((value) => value + 1)
      }
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

  const enroll = useCallback(
    async (token = '') => {
      if (!planReady(setup)) {
        setError('Finish setup first.')
        return
      }
      if (status?.externalOwnerWalletPub && setup.hardwarePub !== status.externalOwnerWalletPub) {
        setError('This vault expects a different hardware key.')
        return
      }
      if (status?.enrollmentMode === 'token' && token.trim().length < 32) {
        setError('Paste your invite.')
        return
      }
      setBusy(true)
      setError('')
      try {
        const out = await enrollWithPasskey(token, {
          hardwarePub: setup.hardwarePub,
          ...(setup.recoveryPub ? { recoveryPub: setup.recoveryPub } : {}),
        })
        setEnrollment(out.enrollment)
        saveEnrollment(out.enrollment)
        if (out.enrollment.vaultId) saveSelectedVaultId(out.enrollment.vaultId)
        setStatus(out.status)
        setAddressPin(loadAddressPin(localStorage, out.status.vaultId))
        sealPlan()
        if (setup.recoveryPub) {
          try {
            const kit = kitFromFacts({
              enrollment: out.enrollment,
              status: out.status,
              hardwarePub: setup.hardwarePub,
              recoveryPub: setup.recoveryPub || out.status.recoveryPub,
            })
            if (kit) {
              saveLocalKit(kit)
              const hardwarePub = setup.hardwarePub || out.status.externalOwnerWalletPub || ''
              const wrap = hardwarePub ? await wrapMapForHardware(kit, hardwarePub) : undefined
              await pushMapBackup(kit.descriptor.vaultId, kit, wrap)
            }
          } catch {
            // Map stays on this device if the service cannot store it yet.
          }
        }
        try {
          setStatus(await enablePasskeyLogin(out.enrollment))
        } catch {
          setError('Vault is set up. Other-device sign-in is not on yet. Tap Allow other devices and use Face ID.')
        }
        await refreshBalance(out.status.vaultId)
        setScreen('home')
      } catch (err) {
        setError(humanizeVaultError(err))
      } finally {
        setBusy(false)
      }
    },
    [refreshBalance, sealPlan, setup, status],
  )

  const enableOtherDevices = useCallback(async () => {
    if (!enrollment) {
      setError('Finish setup first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setStatus(await enablePasskeyLogin(enrollment))
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [enrollment])

  const signIn = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const local = enrollment || findStoredEnrollment()
      if (local) {
        const unlocked = await unlockLocalEnrollment(local)
        setEnrollment(unlocked)
        saveEnrollment(unlocked)
        if (unlocked.vaultId) saveSelectedVaultId(unlocked.vaultId)
        setSessionLocked(false)
        setLocked(false)
        const live = unlocked.vaultId ? await fetchVaultStatus(undefined, unlocked.vaultId) : await fetchVaultStatus()
        setStatus(live)
        if (live.vaultId) setAddressPin(loadAddressPin(localStorage, live.vaultId))
        try {
          const pulled = live.vaultId ? await pullMapBackup(live.vaultId) : null
          const kit =
            pulled?.kit ||
            kitFromFacts({
              enrollment: unlocked,
              status: live,
              hardwarePub: setup.hardwarePub,
              recoveryPub: setup.recoveryPub || live.recoveryPub,
            })
          if (kit) saveLocalKit(kit)
        } catch {
          // Sign-in still succeeds if the map cannot be rebuilt yet.
        }
        await refreshBalance(live.vaultId)
        setScreen('home')
        return
      }
      const selected = loadSelectedVaultId()
      const vaultId = selected || (await discoverVaultIdFromPasskey())
      const out = await signInWithPasskey(vaultId)
      setEnrollment(out.enrollment)
      saveEnrollment(out.enrollment)
      if (out.enrollment.vaultId) saveSelectedVaultId(out.enrollment.vaultId)
      setSessionLocked(false)
      setLocked(false)
      setStatus(out.status)
      setAddressPin(loadAddressPin(localStorage, out.status.vaultId))
      try {
        const pulled = out.status.vaultId ? await pullMapBackup(out.status.vaultId) : null
        const kit =
          pulled?.kit ||
          kitFromFacts({
            enrollment: out.enrollment,
            status: out.status,
            hardwarePub: setup.hardwarePub,
            recoveryPub: setup.recoveryPub || out.status.recoveryPub,
          })
        if (kit) saveLocalKit(kit)
      } catch {
        // Sign-in still succeeds if the map cannot be rebuilt yet.
      }
      await refreshBalance(out.status.vaultId)
      setScreen('home')
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [enrollment, refreshBalance, setup.hardwarePub, setup.recoveryPub])

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
    const source = account === 'savings' ? savingsBalance : vtxoMaxCoin
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
        spend.amount + spend.fee <= vtxoBalance &&
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
    savingsBalance,
    setup.txCapSats,
    spend,
    status?.network,
    status?.enrolled,
    vtxoBalance,
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
    const coin = confirmedSpendable(utxos, need)
    if (!coin) throw new Error('No confirmed savings coin is large enough.')
    const tip = await fetchTipHeight()
    const leaf = chooseSavingsLeafForStatus(
      status,
      { txid: coin.txid, vout: coin.vout, value: coin.value, confirmedHeight: coin.status.block_height },
      tip,
    )
    if (spend.address === status.vtxoBoardingAddress) await verifyVaultBoarding(status)
    const unsigned = buildSavingsPsbt({
      status,
      phonePub: enrollment.phoneRoutineBip340Pub,
      destAddress: spend.address,
      amountSats: spend.amount,
      feeSats: spend.fee,
      coin: { txid: coin.txid, vout: coin.vout, value: coin.value, confirmedHeight: coin.status.block_height },
      leaf,
    })
    const secret = await unlockPhoneRoutine(enrollment, status)
    try {
      const signed = signSavingsPsbt(unsigned, secret)
      if (leaf === 'phoneCsv') {
        const final = finalizeSavingsPsbt(signed)
        const txid = await broadcastTx(final.txHex)
        await finishBroadcast(txid)
        return
      }
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

  useEffect(() => {
    const id = status?.vaultId || enrollment?.vaultId || ''
    const template = String(status?.templateVersion || '')
    setInitiateAlerts([])
    setInitiateAlert('')
    const kit = selectLiveKit({
      vaultId: id,
      templateVersion: template,
      stored: id ? loadLocalKit(id) : null,
    })
    if (!kit) return
    let cancelled = false
    const tick = async () => {
      try {
        const seen = loadSeenOutpoints(kit.descriptor.vaultId)
        const next = await pollPendingInitiates({
          descriptor: kit.descriptor,
          fetchUtxos: fetchAddressUtxos,
          seen,
        })
        if (cancelled) return
        saveSeenOutpoints(kit.descriptor.vaultId, next.seen)
        if (next.alerts.length) {
          setInitiateAlerts((prev) => [...next.alerts, ...prev].slice(0, 12))
          setInitiateAlert(alertCopy(next.alerts[0]))
        }
      } catch {
        // Best-effort local poll. This is not a watchtower.
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 20_000)
    const onFocus = () => void tick()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [enrollment?.vaultId, status?.templateVersion, status?.vaultId])

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
      unlockMapWithHardware,
      signGuardianExitWithDevice,
      hasRecoveryKit: Boolean(resolveKit()),
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
      onchainSpendingSats: chainBalance,
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
      savingsSats: savingsBalance,
      screen: loaded ? screen : 'welcome',
      setAccount,
      setCondition,
      setSpendDraft,
      setup,
      signIn,
      spend,
      status,
      lastSend,
      vtxoSpendingSats: vtxoBalance,
    }),
    [
      acceptDesign,
      account,
      amountSats,
      chainBalance,
      applyHardware,
      applyRecovery,
      skipRecovery,
      downloadRecoveryKit,
      backupRecoveryKit,
      boardingAddress,
      boardingInProgress,
      restoreRecoveryKit,
      unlockMapWithHardware,
      signGuardianExitWithDevice,
      resolveKit,
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
      savingsBalance,
      screen,
      setCondition,
      setSpendDraft,
      setup,
      spend,
      status?.enrolled,
      status?.periodSpent,
      vtxoBalance,
      vtxoMaxCoin,
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

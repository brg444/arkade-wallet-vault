import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fetchDemoInfo, vaultPost } from '../lib/vault/api'
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
  fetchTxHex,
} from '../lib/vault/esplora'
import { historyFromTxs, type VaultHistoryItem } from '../lib/vault/history'
import {
  buildSavingsPsbt,
  chooseSavingsLeaf,
  finalizeSavingsPsbt,
  parseHardwareSecret,
  parseIncomingPsbt,
  requireSameSavingsIntent,
  signSavingsPsbt,
  unlockPhoneRoutine,
} from '../lib/vault/savingsSpend'
import { sendRoutineSpend } from '../lib/vault/spend'
import { humanizeVaultError } from '../lib/vault/humanize'
import { isVaultBitcoinAddress } from '../lib/vault/bitcoin'
import { fetchVaultStatus } from '../lib/vault/status'
import {
  clearSetupPlan,
  emptySetupPlan,
  loadSetupPlan,
  isFixturePub,
  parseCompressedPub,
  planReady,
  saveSetupPlan,
  sameRole,
  type VaultSetupPlan,
} from '../lib/vault/setupPlan'

import { isStagedTemplate } from '../lib/vault/v5/constants'

import { buildRecoveryKit } from '../lib/vault/v5/kit'
import {
  kitFromFacts,
  pullMapBackup,
  pushMapBackup,
  unwrapMapWithHardware,
  wrapMapForHardware,
  type HardwareMapWrap,
} from '../lib/vault/v5/kitBackup'

import { findLocalKit, loadLocalKit, saveLocalKit } from '../lib/vault/v5/kitStore'
import { previewV5Descriptor } from '../lib/vault/v5/preview'
import {
  alertCopy,
  loadSeenOutpoints,
  pollPendingInitiates,
  saveSeenOutpoints,
  type InitiateAlert,
} from '../lib/vault/v5/watch'
import type { VaultStatus } from '../lib/vault/types'

export type VaultAccount = 'spend' | 'savings'

export type VaultScreen =
  | 'welcome'
  | 'design'
  | 'hardware'
  | 'conditions'
  | 'plan'
  | 'passkey'
  | 'home'
  | 'receive'
  | 'send'
  | 'review'
  | 'success'
  | 'keys'
  | 'settings'
  | 'signin'
  | 'handoff'
  | 'hwsign'
  | 'recovery'
  | 'recover'
  | 'tx'

export interface VaultSpend {
  address: string
  amount: number
  fee: number
}

interface VaultContextProps {
  acceptDesign: () => void
  account: VaultAccount
  addTestCoins: () => Promise<void>
  amountSats: number
  applyHardware: (raw: string, demo?: boolean) => void
  applyRecovery: (raw: string, demo?: boolean) => void
  skipRecovery: () => void
  downloadRecoveryKit: () => string
  backupRecoveryKit: () => Promise<boolean>
  restoreRecoveryKit: () => Promise<void>
  unlockMapWithHardware: (wrapRaw: string, hardwareSecret: string) => Promise<void>
  hasRecoveryKit: boolean
  initiateAlert: string
  initiateAlerts: InitiateAlert[]
  approvePreviewSend: () => Promise<void>
  busy: boolean
  canSend: boolean
  completeSavingsHandoff: (signedPsbt: string) => Promise<void>
  handoffPsbt: string
  confirmConditions: () => void
  dailyLimit: number
  dailyRemaining: number
  dailySpent: number
  demoAvailable: boolean
  enterWithoutPasskey: () => void
  enablePasskeyLogin: () => Promise<void>
  enroll: (token?: string) => Promise<void>
  enrolled: boolean
  error: string
  signIn: () => Promise<void>
  finishPlan: () => void
  faucetUrl: string
  hasLocalEnrollment: boolean
  locked: boolean
  lastTxid: string
  history: VaultHistoryItem[]
  selectedTx: VaultHistoryItem | null
  openTx: (tx: VaultHistoryItem) => void
  liveNetwork: boolean
  allowDemoKeys: boolean
  navigate: (screen: VaultScreen) => void
  openRecover: (view?: 'kit' | 'lost', exit?: VaultScreen) => void
  recoverEntry: 'kit' | 'lost'
  recoverExit: VaultScreen
  networkLabel: string
  operationalAddress: string
  preview: boolean
  refreshBalance: () => Promise<void>
  reset: () => void
  reviewSpend: () => void
  openSendScan: () => void
  scanOnSend: boolean
  clearSendScan: () => void
  savingsAddress: string
  savingsSats: number
  screen: VaultScreen
  setAccount: (account: VaultAccount) => void
  setCondition: (
    patch: Partial<Pick<VaultSetupPlan, 'txCapSats' | 'dailyLimitSats' | 'operationalCsvBlocks' | 'savingsCsvBlocks'>>,
  ) => void
  setSpendDraft: (draft: Partial<VaultSpend>) => void
  setup: VaultSetupPlan
  spend: VaultSpend
  status: VaultStatus | null
  lastSend: VaultSpend | null
}

const DEFAULT_FEE = 500
const LIVE_FEE = 1500

export const VaultContext = createContext<VaultContextProps>({
  acceptDesign: () => {},
  account: 'spend',
  addTestCoins: async () => {},
  amountSats: 0,
  applyHardware: () => {},
  applyRecovery: () => {},
  skipRecovery: () => {},
  downloadRecoveryKit: () => '',
  backupRecoveryKit: async () => false,
  restoreRecoveryKit: async () => {},
  unlockMapWithHardware: async () => {},
  hasRecoveryKit: false,
  initiateAlert: '',
  initiateAlerts: [],
  approvePreviewSend: async () => {},
  busy: false,
  canSend: false,
  completeSavingsHandoff: async () => {},
  handoffPsbt: '',
  confirmConditions: () => {},
  dailyLimit: 0,
  dailyRemaining: 0,
  dailySpent: 0,
  demoAvailable: false,
  enterWithoutPasskey: () => {},
  enablePasskeyLogin: async () => {},
  enroll: async () => {},
  enrolled: false,
  error: '',
  signIn: async () => {},
  finishPlan: () => {},
  faucetUrl: 'https://faucet.mutinynet.com/',
  hasLocalEnrollment: false,
  locked: false,
  lastTxid: '',
  history: [],
  selectedTx: null,
  openTx: () => {},
  liveNetwork: false,
  allowDemoKeys: false,
  navigate: () => {},
  openRecover: () => {},
  recoverEntry: 'kit',
  recoverExit: 'keys',
  networkLabel: 'Test network',
  operationalAddress: '',
  preview: true,
  refreshBalance: async () => {},
  reset: () => {},
  reviewSpend: () => {},
  openSendScan: () => {},
  scanOnSend: false,
  clearSendScan: () => {},
  savingsAddress: '',
  savingsSats: 0,
  screen: 'welcome',
  setAccount: () => {},
  setCondition: () => {},
  setSpendDraft: () => {},
  setup: emptySetupPlan(),
  spend: { address: '', amount: 0, fee: DEFAULT_FEE },
  status: null,
  lastSend: null,
})

export function VaultProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<VaultScreen>('welcome')
  const [recoverEntry, setRecoverEntry] = useState<'kit' | 'lost'>('kit')
  const [recoverExit, setRecoverExit] = useState<VaultScreen>('keys')
  const [setup, setSetup] = useState<VaultSetupPlan>(emptySetupPlan)
  const [preview, setPreview] = useState(false)
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [enrollment, setEnrollment] = useState<EnrollmentSecrets | null>(null)
  const [initiateAlert, setInitiateAlert] = useState('')
  const [initiateAlerts, setInitiateAlerts] = useState<InitiateAlert[]>([])

  const [demoAvailable, setDemoAvailable] = useState(false)
  const [demoCredit, setDemoCredit] = useState(0)
  const [previewSpent, setPreviewSpent] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [spend, setSpend] = useState<VaultSpend>({ address: '', amount: 0, fee: DEFAULT_FEE })
  const [lastSend, setLastSend] = useState<VaultSpend | null>(null)
  const [lastTxid, setLastTxid] = useState('')
  const [history, setHistory] = useState<VaultHistoryItem[]>([])
  const [selectedTx, setSelectedTx] = useState<VaultHistoryItem | null>(null)
  const [chainBalance, setChainBalance] = useState(0)
  const [savingsBalance, setSavingsBalance] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [account, setAccount] = useState<VaultAccount>('spend')
  const [scanOnSend, setScanOnSend] = useState(false)
  const [handoffPsbt, setHandoffPsbt] = useState('')
  const [statusKnown, setStatusKnown] = useState(false)
  const [locked, setLocked] = useState(false)
  const [addressPin, setAddressPin] = useState<AddressPin | null>(null)

  useEffect(() => {
    let existing: EnrollmentSecrets | null = null
    try {
      const plan = loadSetupPlan()
      if (plan) {
        setSetup(plan)
        if (plan.complete) {
          setPreview(true)
          setScreen('home')
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
      } finally {
        setStatusKnown(true)
      }
    }
    void boot()
    fetchDemoInfo()
      .then((info) => setDemoAvailable(Boolean(info?.demo)))
      .catch(() => setDemoAvailable(false))
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
  const savingsAddress = addressPin?.savingsAddress || ''
  const liveNetwork = status?.network === 'mutinynet'
  const allowDemoKeys = statusKnown && !liveNetwork
  const dailyLimit = status?.enrolled ? (status.periodAllowance ?? setup.dailyLimitSats) : setup.dailyLimitSats
  const dailyRemaining = status?.enrolled
    ? (status.periodRemaining ?? dailyLimit)
    : Math.max(0, dailyLimit - previewSpent)
  const amountSats = status?.enrolled ? chainBalance : demoCredit
  const enrolled = Boolean(status?.enrolled)
  const networkLabel = liveNetwork ? 'Mutinynet' : 'Test network'

  const acceptDesign = useCallback(() => {
    persist({ ...setup, acceptedDesign: true })
    setError('')
    setScreen('hardware')
  }, [persist, setup])

  const applyHardware = useCallback(
    (raw: string, demo = false) => {
      setError('')
      try {
        const hardwarePub = parseCompressedPub(raw, 'hardware key')
        if ((liveNetwork || status?.network === 'mutinynet') && isFixturePub(hardwarePub)) {
          throw new Error('Demo keys cannot be used on this vault')
        }
        if (status?.externalOwnerWalletPub && hardwarePub !== status.externalOwnerWalletPub) {
          throw new Error('This Mutinynet vault requires the hardware key already configured on the service')
        }
        persist({ ...setup, hardwarePub, hardwareIsDemo: demo })
        setScreen('recovery')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [liveNetwork, persist, setup, status?.externalOwnerWalletPub, status?.network],
  )

  const applyRecovery = useCallback(
    (raw: string, demo = false) => {
      setError('')
      try {
        const recoveryPub = parseCompressedPub(raw, 'recovery key')
        if (!setup.hardwarePub) throw new Error('Set hardware first')
        if (sameRole(recoveryPub, setup.hardwarePub)) throw new Error('Recovery must be a different key')
        if ((liveNetwork || status?.network === 'mutinynet') && isFixturePub(recoveryPub)) {
          throw new Error('Demo keys cannot be used on this vault')
        }
        persist({ ...setup, recoveryPub, recoveryIsDemo: demo })
        setScreen('conditions')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [liveNetwork, persist, setup, status?.network],
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

  const localV5Descriptor = useCallback(() => {
    if (!setup.hardwarePub || !setup.recoveryPub) return null
    try {
      return previewV5Descriptor({
        vaultId: status?.vaultId || enrollment?.vaultId,
        network: status?.network === 'regtest' ? 'regtest' : 'mutinynet',
        hardwarePub: setup.hardwarePub,
        recoveryPub: setup.recoveryPub,
        phonePub: enrollment?.phoneRoutineBip340Pub,
        phoneDirectP256: enrollment?.phoneDirectP256,
      })
    } catch {
      return null
    }
  }, [enrollment, setup.hardwarePub, setup.recoveryPub, status?.network, status?.vaultId])

  const sealPlan = useCallback(() => {
    const next = persist({ ...setup, complete: true })
    const descriptor = localV5Descriptor()
    if (descriptor) saveLocalKit(buildRecoveryKit(descriptor))
    setPreview(!status?.enrolled)
    return next
  }, [localV5Descriptor, persist, setup, status?.enrolled])

  const resolveKit = useCallback(() => {
    const id = status?.vaultId || enrollment?.vaultId || ''
    const stored = (id && loadLocalKit(id)) || findLocalKit()
    if (stored) return stored
    const fromFacts = kitFromFacts({
      enrollment,
      status,
      hardwarePub: setup.hardwarePub,
      recoveryPub: setup.recoveryPub || status?.recoveryPub,
    })
    if (fromFacts) return fromFacts
    const descriptor = localV5Descriptor()
    return descriptor ? buildRecoveryKit(descriptor) : null
  }, [enrollment, localV5Descriptor, setup.hardwarePub, setup.recoveryPub, status])

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

  const enterWithoutPasskey = useCallback(() => {
    setError('')
    if (!planReady(setup)) {
      setError('Finish setup first.')
      return
    }
    sealPlan()
    setScreen('home')
  }, [sealPlan, setup])

  const refreshBalance = useCallback(
    async (vaultId?: string) => {
      const id = String(vaultId || status?.vaultId || addressPin?.vaultId || '').trim()
      const pin = id ? loadAddressPin(localStorage, id) : null
      const address = pin?.operationalAddress || ''
      const savings = pin?.savingsAddress || ''
      if (!address && !savings) {
        setChainBalance(0)
        setSavingsBalance(0)
        setHistory([])
        return
      }
      try {
        if (address) {
          const stats = await fetchAddressStats(address)
          setChainBalance(Math.max(0, stats.funded - stats.spent))
        }
        if (savings) {
          const stats = await fetchAddressStats(savings)
          setSavingsBalance(Math.max(0, stats.funded - stats.spent))
        } else {
          setSavingsBalance(0)
        }
        const [spendTxs, savTxs] = await Promise.all([
          address ? fetchAddressTxs(address).catch(() => []) : Promise.resolve([]),
          savings ? fetchAddressTxs(savings).catch(() => []) : Promise.resolve([]),
        ])
        setHistory([...historyFromTxs(spendTxs, address, 'spend'), ...historyFromTxs(savTxs, savings, 'savings')])
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [addressPin, status?.vaultId],
  )

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
      if (status?.network === 'mutinynet' && status.enrollmentMode === 'token' && token.trim().length < 32) {
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
        setPreview(false)
        if (setup.recoveryPub) {
          try {
            const kit = resolveKit()
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
    [refreshBalance, resolveKit, sealPlan, setup, status],
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
        setPreview(false)
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
      setPreview(false)
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

  const addTestCoins = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      if (demoAvailable && status?.enrolled) {
        await vaultPost('/v1/demo/fund', { amount: setup.dailyLimitSats })
        const funded = enrollment?.vaultId
          ? await fetchVaultStatus(undefined, enrollment.vaultId)
          : await fetchVaultStatus()
        setStatus(funded)
        if (funded.vaultId) setAddressPin(loadAddressPin(localStorage, funded.vaultId))
      } else {
        setDemoCredit(setup.dailyLimitSats)
        setPreviewSpent(0)
        setPreview(true)
      }
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [demoAvailable, setup.dailyLimitSats, status?.enrolled])

  const setSpendDraft = useCallback((draft: Partial<VaultSpend>) => {
    setSpend((prev) => ({ ...prev, ...draft }))
    setError('')
  }, [])

  const reviewSpend = useCallback(() => {
    setError('')
    if (!isVaultBitcoinAddress(spend.address, status?.network || (preview ? 'regtest' : 'mutinynet'))) {
      setError('Enter a bitcoin address.')
      return
    }
    if (!Number.isInteger(spend.amount) || spend.amount < DUST_SATS) {
      setError('At least 330 sats.')
      return
    }
    const source = account === 'savings' ? savingsBalance : amountSats
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
      setError(account === 'savings' ? 'Not enough confirmed savings.' : 'Leave 330 sats of change.')
      return
    }
    if (account !== 'savings' && spend.amount + spend.fee + DUST_SATS > amountSats) {
      setError('Leave 330 sats of change.')
      return
    }
    if (account === 'savings' && spend.amount + spend.fee < source && source - (spend.amount + spend.fee) < DUST_SATS) {
      setError('Leave 330 sats of change, or send the rest.')
      return
    }
    setScreen('review')
  }, [account, amountSats, dailyRemaining, preview, savingsBalance, setup.txCapSats, spend, status?.network])

  const finishBroadcast = useCallback(
    async (txid: string) => {
      setLastTxid(txid)
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
    const leaf = chooseSavingsLeaf(
      { txid: coin.txid, vout: coin.vout, value: coin.value, confirmedHeight: coin.status.block_height },
      tip,
      status.operationalCsvBlocks,
    )
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

  const approvePreviewSend = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      if (account === 'savings') {
        if (status?.enrolled) {
          await approveSavingsSend()
          return
        }
        if (!preview) {
          setError('Vault isn’t ready to send.')
          return
        }
        setLastSend(spend)
        setLastTxid('')
        setSpend({ address: '', amount: 0, fee: DEFAULT_FEE })
        setScreen('success')
        return
      }
      if (status?.enrolled) {
        if (!enrollment) {
          setError('Sign in with the passkey that created this vault.')
          return
        }
        if (!operationalAddress) {
          setError('No spending address yet.')
          return
        }
      }
      if (status?.enrolled && enrollment && operationalAddress) {
        const need = spend.amount + spend.fee
        const utxos = await fetchAddressUtxos(operationalAddress)
        const coin = confirmedSpendable(utxos, need)
        if (!coin) throw new Error('No confirmed Mutinynet coin is large enough. Fund the spending address first.')
        const prevTxHex = await fetchTxHex(coin.txid)
        const result = await sendRoutineSpend({
          enrollment,
          status,
          destAddress: spend.address,
          amountSats: spend.amount,
          feeSats: spend.fee,
          prevTxHex,
          vout: coin.vout,
        })
        await finishBroadcast(result.txid)
        return
      }
      if (status?.enrolled || !preview) {
        setError('Vault isn’t ready to send.')
        return
      }
      setLastSend(spend)
      const outflow = spend.amount + spend.fee
      setDemoCredit((n) => Math.max(0, n - outflow))
      setPreviewSpent((n) => n + outflow)
      setLastTxid('')
      setSpend({ address: '', amount: 0, fee: DEFAULT_FEE })
      setScreen('success')
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [account, approveSavingsSend, enrollment, finishBroadcast, operationalAddress, preview, spend, status])

  const reset = useCallback(() => {
    setSessionLocked(true)
    setLocked(true)
    setPreview(false)
    setDemoCredit(0)
    setPreviewSpent(0)
    setError('')
    setSpend({ address: '', amount: 0, fee: liveNetwork ? LIVE_FEE : DEFAULT_FEE })
    setLastSend(null)
    setLastTxid('')
    setAccount('spend')
    setScanOnSend(false)
    setHandoffPsbt('')
    setScreen('welcome')
  }, [liveNetwork])

  useEffect(() => {
    const liveV5 = isStagedTemplate(String(status?.templateVersion || ''))
    const id = status?.vaultId || enrollment?.vaultId || ''
    const kit = (id && loadLocalKit(id)) || findLocalKit()
    if (!liveV5 || !kit) return
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
        // Watcher is best-effort. Missing coins is not a send failure.
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
      addTestCoins,
      amountSats,
      applyHardware,
      applyRecovery,
      skipRecovery,
      downloadRecoveryKit,
      backupRecoveryKit,
      restoreRecoveryKit,
      unlockMapWithHardware,
      hasRecoveryKit: Boolean(resolveKit()),
      initiateAlert,
      initiateAlerts,
      approvePreviewSend,
      busy,
      canSend: amountSats > DUST_SATS + spend.fee,
      completeSavingsHandoff,
      handoffPsbt,
      confirmConditions,
      dailyLimit,
      dailyRemaining,
      dailySpent: status?.enrolled ? (status.periodSpent ?? 0) : Math.max(0, dailyLimit - dailyRemaining),
      demoAvailable,
      enablePasskeyLogin: enableOtherDevices,
      enterWithoutPasskey,
      enroll,
      enrolled,
      error,
      finishPlan,
      faucetUrl: 'https://faucet.mutinynet.com/',
      hasLocalEnrollment: Boolean(enrollment),
      locked,
      lastTxid,
      history: history.filter((item) => item.account === account),
      selectedTx,
      openTx: (tx) => {
        setSelectedTx(tx)
        setError('')
        setScreen('tx')
      },
      liveNetwork,
      allowDemoKeys,
      navigate: (next) => {
        setError('')
        if (next === 'send' && account === 'savings' && !spend.address && operationalAddress) {
          setSpend((prev) => ({ ...prev, address: operationalAddress }))
        }
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
      preview: preview || !status?.enrolled,
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
    }),
    [
      acceptDesign,
      account,
      addTestCoins,
      amountSats,
      applyHardware,
      applyRecovery,
      skipRecovery,
      downloadRecoveryKit,
      backupRecoveryKit,
      restoreRecoveryKit,
      unlockMapWithHardware,
      resolveKit,
      initiateAlert,
      initiateAlerts,
      approvePreviewSend,
      busy,
      completeSavingsHandoff,
      confirmConditions,
      handoffPsbt,
      dailyLimit,
      dailyRemaining,
      demoAvailable,
      enableOtherDevices,
      enrollment,
      enterWithoutPasskey,
      enroll,
      signIn,
      enrolled,
      error,
      finishPlan,
      lastTxid,
      history,
      selectedTx,
      liveNetwork,
      locked,
      allowDemoKeys,
      lastSend,
      recoverEntry,
      recoverExit,
      loaded,
      networkLabel,
      operationalAddress,
      preview,
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
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchDemoInfo, vaultPost } from '../lib/vault/api'
import { DUST_SATS } from '../lib/vault/constants'
import { enrollWithPasskey, type EnrollmentSecrets } from '../lib/vault/enroll'
import { humanizeVaultError } from '../lib/vault/humanize'
import { isVaultBitcoinAddress } from '../lib/vault/bitcoin'
import { sampleDescriptor } from '../lib/vault/sample'
import { fetchVaultStatus } from '../lib/vault/status'
import { clearWatchRecord, saveWatchRecord } from '../lib/vault/store'
import {
  clearSetupPlan,
  emptySetupPlan,
  loadSetupPlan,
  parseCompressedPub,
  planReady,
  sameRole,
  saveSetupPlan,
  type VaultSetupPlan,
} from '../lib/vault/setup'
import type { VaultPublicDescriptor, VaultStatus } from '../lib/vault/types'

export type VaultScreen =
  | 'welcome'
  | 'design'
  | 'hardware'
  | 'recovery'
  | 'conditions'
  | 'plan'
  | 'passkey'
  | 'home'
  | 'receive'
  | 'send'
  | 'review'
  | 'success'
  | 'savings'

export interface VaultSpend {
  address: string
  amount: number
  fee: number
}

interface VaultContextProps {
  acceptDesign: () => void
  addTestCoins: () => Promise<void>
  amountSats: number
  applyHardware: (raw: string, demo?: boolean) => void
  applyRecovery: (raw: string, demo?: boolean) => void
  approvePreviewSend: () => void
  busy: boolean
  canSend: boolean
  confirmConditions: () => void
  dailyLimit: number
  dailyRemaining: number
  dailySpent: number
  demoAvailable: boolean
  enterWithoutPasskey: () => void
  enroll: () => Promise<void>
  enrolled: boolean
  error: string
  finishPlan: () => void
  navigate: (screen: VaultScreen) => void
  networkLabel: string
  operationalAddress: string
  preview: boolean
  reset: () => void
  reviewSpend: () => void
  savingsAddress: string
  screen: VaultScreen
  setCondition: (
    patch: Partial<Pick<VaultSetupPlan, 'txCapSats' | 'dailyLimitSats' | 'operationalCsvBlocks' | 'savingsCsvBlocks'>>,
  ) => void
  setSpendDraft: (draft: Partial<VaultSpend>) => void
  setup: VaultSetupPlan
  spend: VaultSpend
  lastSend: VaultSpend | null
}

const DEFAULT_FEE = 500

export const VaultContext = createContext<VaultContextProps>({
  acceptDesign: () => {},
  addTestCoins: async () => {},
  amountSats: 0,
  applyHardware: () => {},
  applyRecovery: () => {},
  approvePreviewSend: () => {},
  busy: false,
  canSend: false,
  confirmConditions: () => {},
  dailyLimit: 0,
  dailyRemaining: 0,
  dailySpent: 0,
  demoAvailable: false,
  enterWithoutPasskey: () => {},
  enroll: async () => {},
  enrolled: false,
  error: '',
  finishPlan: () => {},
  navigate: () => {},
  networkLabel: 'Test network',
  operationalAddress: '',
  preview: true,
  reset: () => {},
  reviewSpend: () => {},
  savingsAddress: '',
  screen: 'welcome',
  setCondition: () => {},
  setSpendDraft: () => {},
  setup: emptySetupPlan(),
  spend: { address: '', amount: 0, fee: DEFAULT_FEE },
  lastSend: null,
})

export function VaultProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<VaultScreen>('welcome')
  const [setup, setSetup] = useState<VaultSetupPlan>(emptySetupPlan)
  const [preview, setPreview] = useState(false)
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [descriptor, setDescriptor] = useState<VaultPublicDescriptor | null>(null)
  const [enrollment, setEnrollment] = useState<EnrollmentSecrets | null>(null)
  const [demoAvailable, setDemoAvailable] = useState(false)
  const [demoCredit, setDemoCredit] = useState(0)
  const [previewSpent, setPreviewSpent] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [spend, setSpend] = useState<VaultSpend>({ address: '', amount: 0, fee: DEFAULT_FEE })
  const [lastSend, setLastSend] = useState<VaultSpend | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const plan = loadSetupPlan()
      if (plan) {
        setSetup(plan)
        if (plan.complete) {
          setPreview(true)
          setScreen('home')
        }
      }
    } catch {
      clearSetupPlan()
    } finally {
      setLoaded(true)
    }
    fetchVaultStatus()
      .then((live) => setStatus(live))
      .catch(() => {})
    fetchDemoInfo()
      .then((info) => setDemoAvailable(Boolean(info?.demo)))
      .catch(() => setDemoAvailable(false))
  }, [])

  const persist = useCallback((next: VaultSetupPlan) => {
    setSetup(next)
    saveSetupPlan(next)
    return next
  }, [])

  const sample = useMemo(() => sampleDescriptor(), [])
  const plannedDescriptor = useMemo(() => {
    const base = descriptor || sample
    if (!setup.hardwarePub || !setup.recoveryPub) return base
    return {
      ...base,
      keys: {
        ...base.keys,
        externalOwnerWallet: setup.hardwarePub,
        recoveryKey: setup.recoveryPub,
      },
    }
  }, [descriptor, sample, setup])

  const operationalAddress = plannedDescriptor.operational.address
  const savingsAddress = plannedDescriptor.savings.address
  const dailyLimit = setup.dailyLimitSats
  const dailyRemaining = status?.enrolled
    ? (status.periodRemaining ?? dailyLimit)
    : Math.max(0, dailyLimit - previewSpent)
  const amountSats = status?.enrolled ? dailyRemaining : demoCredit
  const enrolled = Boolean(status?.enrolled || enrollment || setup.complete)
  const networkLabel = (status?.network || plannedDescriptor.network) === 'mutinynet' ? 'Mutinynet' : 'Test network'

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
        if (setup.recoveryPub && sameRole(hardwarePub, setup.recoveryPub)) {
          throw new Error('Hardware and recovery must be different keys')
        }
        persist({ ...setup, hardwarePub, hardwareIsDemo: demo })
        setScreen('recovery')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [persist, setup],
  )

  const applyRecovery = useCallback(
    (raw: string, demo = false) => {
      setError('')
      try {
        const recoveryPub = parseCompressedPub(raw, 'recovery key')
        if (setup.hardwarePub && sameRole(recoveryPub, setup.hardwarePub)) {
          throw new Error('Recovery must be a different key than the hardware wallet')
        }
        persist({ ...setup, recoveryPub, recoveryIsDemo: demo })
        setScreen('conditions')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [persist, setup],
  )

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
      setError('The daily limit must be at least as large as one payment.')
      return
    }
    setScreen('plan')
  }, [setup])

  const finishPlan = useCallback(() => {
    setError('')
    if (!planReady(setup)) {
      setError('Finish hardware, recovery, and rules before continuing.')
      return
    }
    setScreen('passkey')
  }, [setup])

  const sealPlan = useCallback(() => {
    const next = persist({ ...setup, complete: true })
    const rec = saveWatchRecord(plannedDescriptor, status?.clientOrigin || 'preview')
    setDescriptor(rec.descriptor)
    setPreview(!status?.enrolled)
    return next
  }, [persist, plannedDescriptor, setup, status?.clientOrigin, status?.enrolled])

  const enterWithoutPasskey = useCallback(() => {
    setError('')
    if (!planReady(setup)) {
      setError('Finish hardware, recovery, and rules before continuing.')
      return
    }
    sealPlan()
    setScreen('home')
  }, [sealPlan, setup])

  const enroll = useCallback(async () => {
    if (!planReady(setup)) {
      setError('Finish hardware, recovery, and rules before creating a passkey.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const out = await enrollWithPasskey()
      setEnrollment(out.enrollment)
      setStatus(out.status)
      sealPlan()
      setPreview(false)
      setScreen('home')
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [sealPlan, setup])

  const addTestCoins = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      if (demoAvailable && status?.enrolled) {
        await vaultPost('/v1/demo/fund', { amount: setup.dailyLimitSats })
        setStatus(await fetchVaultStatus())
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
    if (!isVaultBitcoinAddress(spend.address)) {
      setError('Enter a bitcoin address. Lightning and Ark addresses are not used here.')
      return
    }
    if (!Number.isInteger(spend.amount) || spend.amount < DUST_SATS) {
      setError('Enter an amount of at least 330 sats.')
      return
    }
    if (spend.amount > setup.txCapSats) {
      setError(`That amount is above the per-payment limit of ${setup.txCapSats.toLocaleString()} sats.`)
      return
    }
    if (spend.amount + spend.fee > dailyRemaining) {
      setError('That would go over today’s spending limit.')
      return
    }
    if (spend.amount + spend.fee > amountSats) {
      setError('You do not have enough in spending for that payment.')
      return
    }
    setScreen('review')
  }, [amountSats, dailyRemaining, setup.txCapSats, spend])

  const approvePreviewSend = useCallback(() => {
    setLastSend(spend)
    if (preview || !status?.enrolled) {
      const outflow = spend.amount + spend.fee
      setDemoCredit((n) => Math.max(0, n - outflow))
      setPreviewSpent((n) => n + outflow)
    }
    setSpend({ address: '', amount: 0, fee: DEFAULT_FEE })
    setScreen('success')
  }, [preview, spend, status?.enrolled])

  const reset = useCallback(() => {
    clearSetupPlan()
    clearWatchRecord()
    setSetup(emptySetupPlan())
    setDescriptor(null)
    setEnrollment(null)
    setPreview(false)
    setDemoCredit(0)
    setPreviewSpent(0)
    setError('')
    setSpend({ address: '', amount: 0, fee: DEFAULT_FEE })
    setLastSend(null)
    setScreen('welcome')
  }, [])

  const value = useMemo<VaultContextProps>(
    () => ({
      acceptDesign,
      addTestCoins,
      amountSats,
      applyHardware,
      applyRecovery,
      approvePreviewSend,
      busy,
      canSend: amountSats > DUST_SATS + DEFAULT_FEE,
      confirmConditions,
      dailyLimit,
      dailyRemaining,
      dailySpent: status?.enrolled ? (status.periodSpent ?? 0) : Math.max(0, dailyLimit - dailyRemaining),
      demoAvailable,
      enterWithoutPasskey,
      enroll,
      enrolled,
      error,
      finishPlan,
      navigate: (next) => {
        setError('')
        setScreen(next)
      },
      networkLabel,
      operationalAddress,
      preview: preview || !status?.enrolled,
      reset,
      reviewSpend,
      savingsAddress,
      screen: loaded ? screen : 'welcome',
      setCondition,
      setSpendDraft,
      setup,
      spend,
      lastSend,
    }),
    [
      acceptDesign,
      addTestCoins,
      amountSats,
      applyHardware,
      applyRecovery,
      approvePreviewSend,
      busy,
      confirmConditions,
      dailyLimit,
      dailyRemaining,
      demoAvailable,
      enterWithoutPasskey,
      enroll,
      enrolled,
      error,
      finishPlan,
      lastSend,
      loaded,
      networkLabel,
      operationalAddress,
      preview,
      reset,
      reviewSpend,
      savingsAddress,
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

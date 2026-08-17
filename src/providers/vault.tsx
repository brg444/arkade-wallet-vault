import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchDemoInfo, vaultPost } from '../lib/vault/api'
import { DUST_SATS } from '../lib/vault/constants'
import { enrollWithPasskey, reconcileStagedEnrollment, type EnrollmentSecrets } from '../lib/vault/enroll'
import { enablePasskeyLogin, signInWithPasskey } from '../lib/vault/session'
import {
  clearEnrollment,
  clearSelectedVaultId,
  loadEnrollment,
  loadSelectedVaultId,
  saveEnrollment,
  saveSelectedVaultId,
} from '../lib/vault/enrollment'
import { clearAddressPin, loadAddressPin, type AddressPin } from '../lib/vault/pin'
import { confirmedSpendable, fetchAddressStats, fetchAddressUtxos, fetchTxHex } from '../lib/vault/esplora'
import { sendRoutineSpend } from '../lib/vault/spend'
import { humanizeVaultError } from '../lib/vault/humanize'
import { isVaultBitcoinAddress } from '../lib/vault/bitcoin'
import { sampleDescriptor } from '../lib/vault/sample'
import { fetchVaultStatus } from '../lib/vault/status'
import { clearWatchRecord, saveWatchRecord } from '../lib/vault/store'
import {
  clearSetupPlan,
  emptySetupPlan,
  loadSetupPlan,
  isFixturePub,
  parseCompressedPub,
  planReady,
  sameRole,
  saveSetupPlan,
  type VaultSetupPlan,
} from '../lib/vault/setup'
import type { VaultPublicDescriptor, VaultStatus } from '../lib/vault/types'

export type VaultAccount = 'spend' | 'savings'

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
  | 'keys'
  | 'settings'
  | 'signin'

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
  approvePreviewSend: () => Promise<void>
  busy: boolean
  canSend: boolean
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
  lastTxid: string
  liveNetwork: boolean
  allowDemoKeys: boolean
  navigate: (screen: VaultScreen) => void
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
  approvePreviewSend: async () => {},
  busy: false,
  canSend: false,
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
  lastTxid: '',
  liveNetwork: false,
  allowDemoKeys: false,
  navigate: () => {},
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
  const [lastTxid, setLastTxid] = useState('')
  const [chainBalance, setChainBalance] = useState(0)
  const [savingsBalance, setSavingsBalance] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [account, setAccount] = useState<VaultAccount>('spend')
  const [scanOnSend, setScanOnSend] = useState(false)
  const [statusKnown, setStatusKnown] = useState(false)
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
      existing = selected ? loadEnrollment(localStorage, selected) : loadEnrollment()
      if (existing?.vaultId) saveSelectedVaultId(existing.vaultId)
      const pinId = existing?.vaultId || selected
      setAddressPin(pinId ? loadAddressPin(localStorage, pinId) : null)
      if (existing) {
        setEnrollment(existing)
        setScreen('home')
      }
    } catch {
      clearSetupPlan()
    } finally {
      setLoaded(true)
    }
    const selectedId = existing?.vaultId || loadSelectedVaultId()
    const boot = async () => {
      try {
        const recovered = await reconcileStagedEnrollment()
        if (recovered) {
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
        if (setup.recoveryPub && sameRole(hardwarePub, setup.recoveryPub)) {
          throw new Error('Hardware and recovery must be different keys')
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
        if ((liveNetwork || status?.network === 'mutinynet') && isFixturePub(recoveryPub)) {
          throw new Error('Demo keys cannot be used on this vault')
        }
        if (status?.recoveryKeyPub && recoveryPub !== status.recoveryKeyPub) {
          throw new Error('This Mutinynet vault requires the recovery key already configured on the service')
        }
        if (setup.hardwarePub && sameRole(recoveryPub, setup.hardwarePub)) {
          throw new Error('Recovery must be a different key than the hardware wallet')
        }
        persist({ ...setup, recoveryPub, recoveryIsDemo: demo })
        setScreen('conditions')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [liveNetwork, persist, setup, status?.recoveryKeyPub, status?.network],
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
    const rec = saveWatchRecord(plannedDescriptor, status?.clientOrigin || 'preview')
    setDescriptor(rec.descriptor)
    setPreview(!status?.enrolled)
    return next
  }, [persist, plannedDescriptor, setup, status?.clientOrigin, status?.enrolled])

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
      if (status?.recoveryKeyPub && setup.recoveryPub !== status.recoveryKeyPub) {
        setError('This vault expects a different recovery key.')
        return
      }
      if (status?.network === 'mutinynet' && status.enrollmentMode === 'token' && token.trim().length < 32) {
        setError('Paste your setup code.')
        return
      }
      setBusy(true)
      setError('')
      try {
        const out = await enrollWithPasskey(token, {
          hardwarePub: setup.hardwarePub,
          recoveryPub: setup.recoveryPub,
        })
        setEnrollment(out.enrollment)
        saveEnrollment(out.enrollment)
        if (out.enrollment.vaultId) saveSelectedVaultId(out.enrollment.vaultId)
        setStatus(out.status)
        setAddressPin(loadAddressPin(localStorage, out.status.vaultId))
        sealPlan()
        setPreview(false)
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
      const selected = loadSelectedVaultId()
      const out = selected ? await signInWithPasskey(selected) : await signInWithPasskey()
      setEnrollment(out.enrollment)
      saveEnrollment(out.enrollment)
      if (out.enrollment.vaultId) saveSelectedVaultId(out.enrollment.vaultId)
      setStatus(out.status)
      setAddressPin(loadAddressPin(localStorage, out.status.vaultId))
      setPreview(false)
      await refreshBalance(out.status.vaultId)
      setScreen('home')
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [refreshBalance])

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
    if (spend.amount > setup.txCapSats) {
      setError(`Over the send limit of ${setup.txCapSats.toLocaleString()} sats.`)
      return
    }
    if (spend.amount + spend.fee > dailyRemaining) {
      setError('Over today’s limit.')
      return
    }
    if (spend.amount + spend.fee + DUST_SATS > amountSats) {
      setError('Leave 330 sats of change.')
      return
    }
    setScreen('review')
  }, [amountSats, dailyRemaining, preview, setup.txCapSats, spend, status?.network])

  const approvePreviewSend = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
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
        setLastTxid(result.txid)
        setLastSend(spend)
        setSpend({ address: '', amount: 0, fee: liveNetwork ? LIVE_FEE : DEFAULT_FEE })
        await refreshBalance(status.vaultId)
        const live = enrollment?.vaultId
          ? await fetchVaultStatus(undefined, enrollment.vaultId)
          : await fetchVaultStatus()
        setStatus(live)
        if (live.vaultId) setAddressPin(loadAddressPin(localStorage, live.vaultId))
        setScreen('success')
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
  }, [enrollment, liveNetwork, operationalAddress, refreshBalance, spend, status])

  const reset = useCallback(() => {
    const selected = loadSelectedVaultId()
    clearSetupPlan()
    clearWatchRecord()
    clearEnrollment()
    clearAddressPin()
    if (selected) {
      clearWatchRecord(localStorage, selected)
      clearEnrollment(localStorage, selected)
      clearAddressPin(localStorage, selected)
    }
    clearSelectedVaultId()
    setSetup(emptySetupPlan())
    setDescriptor(null)
    setEnrollment(null)
    setAddressPin(null)
    setPreview(false)
    setDemoCredit(0)
    setPreviewSpent(0)
    setError('')
    setSpend({ address: '', amount: 0, fee: DEFAULT_FEE })
    setLastSend(null)
    setLastTxid('')
    setChainBalance(0)
    setSavingsBalance(0)
    setAccount('spend')
    setScanOnSend(false)
    setScreen('welcome')
  }, [])

  const value = useMemo<VaultContextProps>(
    () => ({
      acceptDesign,
      account,
      addTestCoins,
      amountSats,
      applyHardware,
      applyRecovery,
      approvePreviewSend,
      busy,
      canSend: amountSats > DUST_SATS + spend.fee,
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
      lastTxid,
      liveNetwork,
      allowDemoKeys,
      navigate: (next) => {
        setError('')
        setScreen(next)
      },
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
      approvePreviewSend,
      busy,
      confirmConditions,
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
      liveNetwork,
      allowDemoKeys,
      lastSend,
      loaded,
      networkLabel,
      operationalAddress,
      preview,
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

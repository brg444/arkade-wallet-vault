import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchDemoInfo, vaultPost } from '../lib/vault/api'
import { DUST_SATS, PERIOD_ALLOWANCE_SATS, TX_RECIPIENT_CAP_SATS } from '../lib/vault/constants'
import { enrollWithPasskey, type EnrollmentSecrets } from '../lib/vault/enroll'
import { humanizeVaultError } from '../lib/vault/humanize'
import { isVaultBitcoinAddress } from '../lib/vault/bitcoin'
import { sampleDescriptor } from '../lib/vault/sample'
import { fetchVaultStatus } from '../lib/vault/status'
import { clearWatchRecord, loadWatchRecord, saveWatchRecord } from '../lib/vault/store'
import type { VaultPublicDescriptor, VaultStatus } from '../lib/vault/types'

export type VaultScreen = 'welcome' | 'home' | 'receive' | 'send' | 'review' | 'success' | 'savings'

export interface VaultSpend {
  address: string
  amount: number
  fee: number
}

interface VaultContextProps {
  addTestCoins: () => Promise<void>
  amountSats: number
  approvePreviewSend: () => void
  busy: boolean
  canSend: boolean
  dailyLimit: number
  dailyRemaining: number
  dailySpent: number
  demoAvailable: boolean
  enroll: () => Promise<void>
  enrolled: boolean
  error: string
  lookAround: () => void
  navigate: (screen: VaultScreen) => void
  networkLabel: string
  operationalAddress: string
  preview: boolean
  reset: () => void
  reviewSpend: () => void
  savingsAddress: string
  screen: VaultScreen
  setSpendDraft: (draft: Partial<VaultSpend>) => void
  spend: VaultSpend
  lastSend: VaultSpend | null
}

const PREVIEW_BALANCE = 100_000
const DEFAULT_FEE = 500

export const VaultContext = createContext<VaultContextProps>({
  addTestCoins: async () => {},
  amountSats: 0,
  approvePreviewSend: () => {},
  busy: false,
  canSend: false,
  dailyLimit: PERIOD_ALLOWANCE_SATS,
  dailyRemaining: PERIOD_ALLOWANCE_SATS,
  dailySpent: 0,
  demoAvailable: false,
  enroll: async () => {},
  enrolled: false,
  error: '',
  lookAround: () => {},
  navigate: () => {},
  networkLabel: 'Test network',
  operationalAddress: '',
  preview: true,
  reset: () => {},
  reviewSpend: () => {},
  savingsAddress: '',
  screen: 'welcome',
  setSpendDraft: () => {},
  spend: { address: '', amount: 0, fee: DEFAULT_FEE },
  lastSend: null,
})

export function VaultProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<VaultScreen>('welcome')
  const [preview, setPreview] = useState(false)
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [descriptor, setDescriptor] = useState<VaultPublicDescriptor | null>(null)
  const [enrollment, setEnrollment] = useState<EnrollmentSecrets | null>(null)
  const [demoAvailable, setDemoAvailable] = useState(false)
  const [previewSpent, setPreviewSpent] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [spend, setSpend] = useState<VaultSpend>({ address: '', amount: 0, fee: DEFAULT_FEE })
  const [lastSend, setLastSend] = useState<VaultSpend | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    try {
      const rec = loadWatchRecord()
      if (rec) {
        setDescriptor(rec.descriptor)
        setPreview(true)
        setScreen('home')
      }
    } catch {
      clearWatchRecord()
    } finally {
      setLoaded(true)
    }
    fetchVaultStatus()
      .then((live) => {
        setStatus(live)
        setError('')
      })
      .catch(() => {})
    fetchDemoInfo()
      .then((info) => setDemoAvailable(Boolean(info?.demo)))
      .catch(() => setDemoAvailable(false))
  }, [])

  const sample = useMemo(() => sampleDescriptor(), [])
  const operationalAddress =
    descriptor?.operational.address || status?.operationalAddress || (preview ? sample.operational.address : '')
  const savingsAddress =
    descriptor?.savings.address || status?.savingsAddress || (preview ? sample.savings.address : '')
  const dailyLimit = status?.periodAllowance ?? descriptor?.policy.periodAllowanceSats ?? PERIOD_ALLOWANCE_SATS
  const dailySpent = status?.periodSpent ?? previewSpent
  const dailyRemaining = status?.periodRemaining ?? Math.max(0, dailyLimit - dailySpent)
  const amountSats = preview || !status?.enrolled ? Math.max(0, PREVIEW_BALANCE - previewSpent) : dailyRemaining
  const enrolled = Boolean(status?.enrolled || enrollment || preview)
  const networkLabel = (status?.network || descriptor?.network) === 'mutinynet' ? 'Mutinynet' : 'Test network'

  const lookAround = useCallback(() => {
    const rec = saveWatchRecord(sample, 'preview')
    setDescriptor(rec.descriptor)
    setPreview(true)
    setError('')
    setScreen('home')
  }, [sample])

  const enroll = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const out = await enrollWithPasskey()
      setEnrollment(out.enrollment)
      setStatus(out.status)
      setPreview(false)
      setScreen('home')
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [])

  const addTestCoins = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      if (demoAvailable && status?.enrolled) {
        await vaultPost('/v1/demo/fund', { amount: 100000 })
        setStatus(await fetchVaultStatus())
      } else {
        setPreview(true)
        if (!descriptor) setDescriptor(sample)
        setPreviewSpent(0)
      }
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [demoAvailable, descriptor, sample, status?.enrolled])

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
    if (spend.amount > TX_RECIPIENT_CAP_SATS) {
      setError('That amount is above the per-payment limit of 50,000 sats.')
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
  }, [amountSats, dailyRemaining, spend])

  const approvePreviewSend = useCallback(() => {
    setLastSend(spend)
    if (preview || !status?.enrolled) setPreviewSpent((n) => n + spend.amount + spend.fee)
    setSpend({ address: '', amount: 0, fee: DEFAULT_FEE })
    setScreen('success')
  }, [preview, spend, status?.enrolled])

  const reset = useCallback(() => {
    clearWatchRecord()
    setDescriptor(null)
    setEnrollment(null)
    setPreview(false)
    setPreviewSpent(0)
    setError('')
    setSpend({ address: '', amount: 0, fee: DEFAULT_FEE })
    setLastSend(null)
    setScreen('welcome')
  }, [])

  const value = useMemo<VaultContextProps>(
    () => ({
      addTestCoins,
      amountSats,
      approvePreviewSend,
      busy,
      canSend: amountSats > DUST_SATS + DEFAULT_FEE,
      dailyLimit,
      dailyRemaining,
      dailySpent,
      demoAvailable,
      enroll,
      enrolled,
      error,
      lookAround,
      navigate: setScreen,
      networkLabel,
      operationalAddress,
      preview: preview || !status?.enrolled,
      reset,
      reviewSpend,
      savingsAddress,
      screen: loaded ? screen : 'welcome',
      setSpendDraft,
      spend,
      lastSend,
    }),
    [
      addTestCoins,
      amountSats,
      approvePreviewSend,
      busy,
      dailyLimit,
      dailyRemaining,
      dailySpent,
      demoAvailable,
      enroll,
      enrolled,
      error,
      lastSend,
      loaded,
      lookAround,
      networkLabel,
      operationalAddress,
      preview,
      reset,
      reviewSpend,
      savingsAddress,
      screen,
      setSpendDraft,
      spend,
      status?.enrolled,
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

import { createContext } from 'react'
import type { VaultHistoryItem } from '../lib/vault/history'
import { emptySetupPlan, type VaultSetupPlan } from '../lib/vault/setupPlan'
import type { VaultStatus } from '../lib/vault/types'
import type { InitiateAlert } from '../lib/vault/program/watch'

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
  | 'recovery'
  | 'recover'
  | 'tx'

export interface VaultSpend {
  address: string
  amount: number
  fee: number
}

export interface VaultContextProps {
  acceptDesign: () => void
  account: VaultAccount
  amountSats: number
  applyHardware: (raw: string) => void
  applyRecovery: (raw: string) => void
  skipRecovery: () => void
  downloadRecoveryKit: () => string
  backupRecoveryKit: () => Promise<boolean>
  boardingAddress: string
  boardingInProgress: boolean
  restoreRecoveryKit: () => Promise<void>
  signGuardianExitWithDevice: (psbtHex: string) => Promise<string>
  hasRecoveryKit: boolean
  initiateAlert: string
  initiateAlerts: InitiateAlert[]
  approveSend: () => Promise<void>
  busy: boolean
  canSend: boolean
  completeSavingsHandoff: (signedPsbt: string) => Promise<void>
  handoffPsbt: string
  confirmConditions: () => void
  dailyLimit: number
  dailyRemaining: number
  dailySpent: number
  enablePasskeyLogin: () => Promise<void>
  enroll: (token?: string) => Promise<void>
  enrolled: boolean
  error: string
  signIn: () => Promise<void>
  finishPlan: () => void
  hasLocalEnrollment: boolean
  locked: boolean
  lastTxid: string
  lastTxKind: 'onchain' | 'vtxo' | ''
  history: VaultHistoryItem[]
  selectedTx: VaultHistoryItem | null
  openTx: (tx: VaultHistoryItem) => void
  liveNetwork: boolean
  navigate: (screen: VaultScreen) => void
  openRecover: (view?: 'kit' | 'lost', exit?: VaultScreen) => void
  recoverEntry: 'kit' | 'lost'
  recoverExit: VaultScreen
  networkLabel: string
  spendingArkAddress: string
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
  setSpendDraft: (draft: Partial<VaultSpend>) => void
  setup: VaultSetupPlan
  spend: VaultSpend
  status: VaultStatus | null
  lastSend: VaultSpend | null
  vtxoSpendingSats: number
}

export const DEFAULT_SPEND_FEE_SATS = 500

export const VaultContext = createContext<VaultContextProps>({
  acceptDesign: () => {},
  account: 'spend',
  amountSats: 0,
  applyHardware: () => {},
  applyRecovery: () => {},
  skipRecovery: () => {},
  downloadRecoveryKit: () => '',
  backupRecoveryKit: async () => false,
  boardingAddress: '',
  boardingInProgress: false,
  restoreRecoveryKit: async () => {},
  signGuardianExitWithDevice: async () => '',
  hasRecoveryKit: false,
  initiateAlert: '',
  initiateAlerts: [],
  approveSend: async () => {},
  busy: false,
  canSend: false,
  completeSavingsHandoff: async () => {},
  handoffPsbt: '',
  confirmConditions: () => {},
  dailyLimit: 0,
  dailyRemaining: 0,
  dailySpent: 0,
  enablePasskeyLogin: async () => {},
  enroll: async () => {},
  enrolled: false,
  error: '',
  signIn: async () => {},
  finishPlan: () => {},
  hasLocalEnrollment: false,
  locked: false,
  lastTxid: '',
  lastTxKind: '',
  history: [],
  selectedTx: null,
  openTx: () => {},
  liveNetwork: false,
  navigate: () => {},
  openRecover: () => {},
  recoverEntry: 'kit',
  recoverExit: 'keys',
  networkLabel: 'Test network',
  spendingArkAddress: '',
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
  setSpendDraft: () => {},
  setup: emptySetupPlan(),
  spend: { address: '', amount: 0, fee: DEFAULT_SPEND_FEE_SATS },
  status: null,
  lastSend: null,
  vtxoSpendingSats: 0,
})

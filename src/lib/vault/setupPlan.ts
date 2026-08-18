import { secp256k1 } from '@noble/curves/secp256k1.js'
import {
  DEFAULT_OPERATIONAL_CSV_BLOCKS,
  DEFAULT_SAVINGS_CSV_BLOCKS,
  PERIOD_ALLOWANCE_SATS,
  TX_RECIPIENT_CAP_SATS,
} from './constants'
import { fingerprint, hexToBytes } from './hex'

export const SETUP_STORE_KEY = 'arkade-vault-setup-v4'

export const DEMO_HARDWARE_PUB = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
export const DEMO_RECOVERY_PUB = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'

export function isFixturePub(pub: string): boolean {
  const hex = pub.trim().toLowerCase().replace(/^0x/, '')
  return hex === DEMO_HARDWARE_PUB || hex === DEMO_RECOVERY_PUB
}

export const PAYMENT_CAP_CHOICES = [20_000, 50_000] as const
export const DAILY_LIMIT_CHOICES = [50_000, 100_000] as const

export interface RecoveryProfile {
  id: 'demo'
  label: string
  detail: string
  operationalCsvBlocks: number
  savingsCsvBlocks: number
}

export const RECOVERY_PROFILES: RecoveryProfile[] = [
  {
    id: 'demo',
    label: 'Demo delays',
    detail: 'This device after 144 blocks. Hardware after 6.',
    operationalCsvBlocks: DEFAULT_OPERATIONAL_CSV_BLOCKS,
    savingsCsvBlocks: DEFAULT_SAVINGS_CSV_BLOCKS,
  },
]

export interface VaultSetupPlan {
  hardwarePub: string
  hardwareIsDemo: boolean
  txCapSats: number
  dailyLimitSats: number
  operationalCsvBlocks: number
  savingsCsvBlocks: number
  acceptedDesign: boolean
  complete: boolean
}

export function emptySetupPlan(): VaultSetupPlan {
  return {
    hardwarePub: '',
    hardwareIsDemo: false,
    txCapSats: TX_RECIPIENT_CAP_SATS,
    dailyLimitSats: PERIOD_ALLOWANCE_SATS,
    operationalCsvBlocks: DEFAULT_OPERATIONAL_CSV_BLOCKS,
    savingsCsvBlocks: DEFAULT_SAVINGS_CSV_BLOCKS,
    acceptedDesign: false,
    complete: false,
  }
}

export function parseCompressedPub(raw: string, name = 'key'): string {
  const hex = raw.trim().toLowerCase().replace(/^0x/, '')
  if (!/^(02|03)[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`${name} must be a 33-byte compressed public key`)
  }
  if (!secp256k1.utils.isValidPublicKey(hexToBytes(hex), true)) {
    throw new Error(`${name} is not a valid secp256k1 public key`)
  }
  return hex
}

export function xOnly(pub: string): string {
  return parseCompressedPub(pub).slice(2)
}

export function sameRole(a: string, b: string): boolean {
  if (!a || !b) return false
  try {
    return xOnly(a) === xOnly(b)
  } catch {
    return false
  }
}

export function planReady(plan: VaultSetupPlan): boolean {
  if (!plan.acceptedDesign) return false
  if (!plan.hardwarePub) return false
  if (!PAYMENT_CAP_CHOICES.includes(plan.txCapSats as (typeof PAYMENT_CAP_CHOICES)[number])) return false
  if (!DAILY_LIMIT_CHOICES.includes(plan.dailyLimitSats as (typeof DAILY_LIMIT_CHOICES)[number])) return false
  if (plan.txCapSats > plan.dailyLimitSats) return false
  return true
}

export function loadSetupPlan(storage: Storage = localStorage): VaultSetupPlan | null {
  const raw = storage.getItem(SETUP_STORE_KEY)
  if (!raw) return null
  const parsed = { ...emptySetupPlan(), ...(JSON.parse(raw) as Partial<VaultSetupPlan>) }
  return parsed
}

export function saveSetupPlan(plan: VaultSetupPlan, storage: Storage = localStorage): VaultSetupPlan {
  storage.setItem(SETUP_STORE_KEY, JSON.stringify(plan))
  return plan
}

export function clearSetupPlan(storage: Storage = localStorage) {
  storage.removeItem(SETUP_STORE_KEY)
}

export function shortKey(pub: string): string {
  return pub ? fingerprint(pub, 4) : 'Not set'
}

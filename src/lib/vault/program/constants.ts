import { TAPROOT_NUMS_XONLY } from '../savingsTree'

export const PROGRAM_SCHEMA = 'arkade-vault/v5'
export const STAGED_TEMPLATE = 'phone-hww-recovery-staged-v6'

export function isStagedTemplate(value: string): boolean {
  return value === STAGED_TEMPLATE
}
export const PROGRAM_INTERNAL_TAG = 'arkade-vault/v5/internal'

export const PROGRAM_CSV = {
  hardware: 6,
  phone: 144,
  recovery: 288,
} as const

/** BIP-331 / Core P2A: OP_1 OP_PUSHBYTES_2 4e73 */
export const P2A_SCRIPT_HEX = '51024e73'
/**
 * Funded P2A dust. Zero-value P2A is ephemeral dust and needs a zero-fee v3
 * parent plus a child package. Transitions stay version 2 and pay a parent
 * fee, so the anchor is funded and included in fee arithmetic.
 */
export const P2A_VALUE_SATS = 240
/** Initiate/clawback: out0 dest p2tr, out1 P2A, out2 emulator packet. */
export const P2A_OUTPUT_INDEX = 1
export const PACKET_OUTPUT_INDEX = 2
export const TRANSITION_OUTPUT_COUNT = 3
/** RBF-enabled, no CSV. 0xffffffff is forbidden on initiate/clawback. */
export const TRANSITION_SEQUENCE = 0xfffffffd
/** 3-of-3 + 65-byte control block (2-guardian Savings hardware initiate). */
export const WITNESS_BYTES_367 = 367
/** 3-of-3 + 97-byte control block (4-leaf Pending / Savings / Daily recovery). */
export const WITNESS_BYTES_399 = 399
/** 3-of-3 + 129-byte control block (Daily phone/hardware initiate). */
export const WITNESS_BYTES_431 = 431

export const VAULT_KINDS = ['daily', 'savings'] as const
export type VaultKind = (typeof VAULT_KINDS)[number]

export const CLAIMANTS = ['phone', 'hardware', 'recovery'] as const
export type Claimant = (typeof CLAIMANTS)[number]

export const FAMILY_KEYS = [
  'daily-phone',
  'daily-hardware',
  'daily-recovery',
  'savings-phone',
  'savings-hardware',
  'savings-recovery',
] as const
export type FamilyKey = (typeof FAMILY_KEYS)[number]

export { TAPROOT_NUMS_XONLY }

export const TEMPLATE_REGISTRY = {
  [STAGED_TEMPLATE]: { schema: PROGRAM_SCHEMA, recovery: true, serverFreeClawback: true },
} as const

export function isKnownTemplate(value: string): value is keyof typeof TEMPLATE_REGISTRY {
  return value in TEMPLATE_REGISTRY
}

export function familyClaimants(hasRecovery: boolean): Claimant[] {
  return hasRecovery ? ['phone', 'hardware', 'recovery'] : ['phone', 'hardware']
}

export function familyKeysFor(hasRecovery: boolean): FamilyKey[] {
  const keys: FamilyKey[] = []
  for (const kind of VAULT_KINDS) {
    for (const claimant of familyClaimants(hasRecovery)) {
      keys.push(`${kind}-${claimant}`)
    }
  }
  return keys
}

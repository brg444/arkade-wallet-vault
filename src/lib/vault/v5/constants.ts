import { TAPROOT_NUMS_XONLY } from '../savingsTree'

export const V5_SCHEMA = 'arkade-vault/v5'
export const V5_TEMPLATE = 'phone-hww-recovery-staged-v5'
export const V5_INTERNAL_TAG = 'arkade-vault/v5/internal'

export const V5_CSV = {
  hardware: 6,
  phone: 144,
  recovery: 288,
} as const

/** BIP-331 / Core P2A: OP_1 OP_PUSHBYTES_2 4e73 */
export const P2A_SCRIPT_HEX = '51024e73'
export const P2A_VALUE_SATS = 0
/** Initiate/clawback: out0 dest, out1 P2A, out2 packet */
export const P2A_OUTPUT_INDEX = 1

export const VAULT_KINDS = ['daily', 'savings'] as const
export type VaultKind = (typeof VAULT_KINDS)[number]

export const CLAIMANTS = ['phone', 'hardware', 'recovery'] as const
export type Claimant = (typeof CLAIMANTS)[number]

export { TAPROOT_NUMS_XONLY }

export const TEMPLATE_REGISTRY = {
  'phone-direct-p256-routine-3of3-admin-phone-hww-v4': { schema: 'arkade-vault/v4', recovery: false },
  [V5_TEMPLATE]: { schema: V5_SCHEMA, recovery: true },
} as const

export function isKnownTemplate(value: string): value is keyof typeof TEMPLATE_REGISTRY {
  return value in TEMPLATE_REGISTRY
}

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, encodeUtf8 } from './hex'
import {
  ABSOLUTE_FEE_CEILING_SATS,
  FEERATE_CEILING_SAT_PER_V,
  PERIOD_ALLOWANCE_SATS,
  POLICY_VERSION,
  TX_RECIPIENT_CAP_SATS,
} from './constants'

export const SPENDING_POLICY_PROGRAM = 'vault-policy-v1' as const
export const SPENDING_POLICY_PERIOD = 'rolling-24h' as const

export type SpendingPolicy = {
  program: typeof SPENDING_POLICY_PROGRAM
  schema: typeof POLICY_VERSION
  period: typeof SPENDING_POLICY_PERIOD
  periodAllowanceSats: number
  txRecipientCapSats: number
  absoluteFeeCapSats: number
  feerateCapSatPerV: number
}

export type SpendingPolicyBound = { min: number; max: number }

export type SpendingPolicyCapabilities = {
  program: typeof SPENDING_POLICY_PROGRAM
  schema: typeof POLICY_VERSION
  period: typeof SPENDING_POLICY_PERIOD
  bounds: {
    periodAllowanceSats: SpendingPolicyBound
    txRecipientCapSats: SpendingPolicyBound
    absoluteFeeCapSats: SpendingPolicyBound
    feerateCapSatPerV: SpendingPolicyBound
  }
  presets: { id: string; label: string; policy: SpendingPolicy }[]
}

export const SPENDING_POLICY_BOUNDS = {
  periodAllowanceSats: { min: 330, max: 1_000_000_000 },
  txRecipientCapSats: { min: 330, max: 100_000_000 },
  absoluteFeeCapSats: { min: ABSOLUTE_FEE_CEILING_SATS, max: ABSOLUTE_FEE_CEILING_SATS },
  feerateCapSatPerV: { min: FEERATE_CEILING_SAT_PER_V, max: FEERATE_CEILING_SAT_PER_V },
} as const

export function defaultSpendingPolicy(): SpendingPolicy {
  return {
    program: SPENDING_POLICY_PROGRAM,
    schema: POLICY_VERSION,
    period: SPENDING_POLICY_PERIOD,
    periodAllowanceSats: PERIOD_ALLOWANCE_SATS,
    txRecipientCapSats: TX_RECIPIENT_CAP_SATS,
    absoluteFeeCapSats: ABSOLUTE_FEE_CEILING_SATS,
    feerateCapSatPerV: FEERATE_CEILING_SAT_PER_V,
  }
}

export const CURRENT_SPENDING_POLICY_CAPABILITIES: SpendingPolicyCapabilities = {
  program: SPENDING_POLICY_PROGRAM,
  schema: POLICY_VERSION,
  period: SPENDING_POLICY_PERIOD,
  bounds: SPENDING_POLICY_BOUNDS,
  presets: [
    {
      id: 'lower-exposure',
      label: 'Lower exposure',
      policy: {
        ...defaultSpendingPolicy(),
        txRecipientCapSats: 25_000,
        periodAllowanceSats: 50_000,
      },
    },
    { id: 'everyday', label: 'Everyday', policy: defaultSpendingPolicy() },
  ],
}

function requireBound(value: unknown, bound: SpendingPolicyBound, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < bound.min || Number(value) > bound.max) {
    throw new Error(`${name} must be between ${bound.min} and ${bound.max}`)
  }
  return Number(value)
}

export function validateSpendingPolicy(value: unknown): SpendingPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('spending policy required')
  const p = value as Record<string, unknown>
  const expected = [
    'program',
    'schema',
    'period',
    'periodAllowanceSats',
    'txRecipientCapSats',
    'absoluteFeeCapSats',
    'feerateCapSatPerV',
  ]
  const fields = Object.keys(p)
  if (fields.length !== expected.length || expected.some((name) => !Object.prototype.hasOwnProperty.call(p, name))) {
    throw new Error('spending policy fields')
  }
  if (p.program !== SPENDING_POLICY_PROGRAM) throw new Error('unsupported spending policy program')
  if (p.schema !== POLICY_VERSION) throw new Error('unsupported spending policy schema')
  if (p.period !== SPENDING_POLICY_PERIOD) throw new Error('unsupported spending policy period')
  const policy: SpendingPolicy = {
    program: SPENDING_POLICY_PROGRAM,
    schema: POLICY_VERSION,
    period: SPENDING_POLICY_PERIOD,
    periodAllowanceSats: requireBound(
      p.periodAllowanceSats,
      SPENDING_POLICY_BOUNDS.periodAllowanceSats,
      'period allowance',
    ),
    txRecipientCapSats: requireBound(
      p.txRecipientCapSats,
      SPENDING_POLICY_BOUNDS.txRecipientCapSats,
      'transaction recipient cap',
    ),
    absoluteFeeCapSats: requireBound(
      p.absoluteFeeCapSats,
      SPENDING_POLICY_BOUNDS.absoluteFeeCapSats,
      'absolute fee cap',
    ),
    feerateCapSatPerV: requireBound(p.feerateCapSatPerV, SPENDING_POLICY_BOUNDS.feerateCapSatPerV, 'feerate cap'),
  }
  if (policy.periodAllowanceSats < policy.txRecipientCapSats) {
    throw new Error('period allowance must be at least the transaction recipient cap')
  }
  return policy
}

export function canonicalSpendingPolicy(policy: SpendingPolicy): string {
  return JSON.stringify(validateSpendingPolicy(policy))
}

export function spendingPolicyDigest(policy: SpendingPolicy): string {
  return bytesToHex(sha256(encodeUtf8(canonicalSpendingPolicy(policy))))
}

export function spendingPolicyFromLimits(input: {
  txRecipientCapSats: number
  periodAllowanceSats: number
  absoluteFeeCapSats: number
  feerateCapSatPerV: number
}): SpendingPolicy {
  return validateSpendingPolicy({ ...defaultSpendingPolicy(), ...input })
}

export function sameSpendingPolicy(a: SpendingPolicy, b: SpendingPolicy): boolean {
  return spendingPolicyDigest(a) === spendingPolicyDigest(b)
}

export function requireCurrentSpendingPolicyCapabilities(value: unknown): SpendingPolicyCapabilities {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('spending policy capabilities required')
  const caps = value as SpendingPolicyCapabilities
  const boundNames = Object.keys(SPENDING_POLICY_BOUNDS) as (keyof typeof SPENDING_POLICY_BOUNDS)[]
  const boundsMatch =
    caps.bounds &&
    Object.keys(caps.bounds).length === boundNames.length &&
    boundNames.every(
      (name) =>
        caps.bounds[name]?.min === SPENDING_POLICY_BOUNDS[name].min &&
        caps.bounds[name]?.max === SPENDING_POLICY_BOUNDS[name].max,
    )
  if (
    caps.program !== SPENDING_POLICY_PROGRAM ||
    caps.schema !== POLICY_VERSION ||
    caps.period !== SPENDING_POLICY_PERIOD ||
    !boundsMatch
  ) {
    throw new Error('vault service spending policy capabilities do not match this release')
  }
  if (
    !Array.isArray(caps.presets) ||
    caps.presets.length !== CURRENT_SPENDING_POLICY_CAPABILITIES.presets.length ||
    caps.presets.some((preset, index) => {
      const expected = CURRENT_SPENDING_POLICY_CAPABILITIES.presets[index]
      return (
        !expected ||
        preset.id !== expected.id ||
        preset.label !== expected.label ||
        !sameSpendingPolicy(preset.policy, expected.policy)
      )
    })
  ) {
    throw new Error('vault service spending policy presets do not match this release')
  }
  return caps
}

export const PROTECTION_TIERS = ['standard', 'advanced'] as const

export type ProtectionTier = (typeof PROTECTION_TIERS)[number]

export function requireProtectionTier(value: unknown): ProtectionTier {
  if (value !== 'standard' && value !== 'advanced') throw new Error('unsupported protection tier')
  return value
}

export function requireProtectionTierMatchesRecovery(tier: unknown, recoveryPub: unknown): ProtectionTier {
  const selected = requireProtectionTier(tier)
  const hasRecovery = typeof recoveryPub === 'string' && recoveryPub.trim().length > 0
  if (selected === 'standard' && hasRecovery) throw new Error('Standard protection must not include a recovery key')
  if (selected === 'advanced' && !hasRecovery) throw new Error('Advanced protection requires a recovery key')
  return selected
}

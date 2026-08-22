export const POLICY_VERSION = 'vault-spending-policy-v1'

export const TX_RECIPIENT_CAP_SATS = 50_000
export const PERIOD_ALLOWANCE_SATS = 100_000
export const ABSOLUTE_FEE_CEILING_SATS = 5_000
export const FEERATE_CEILING_SAT_PER_V = 10
export const DUST_SATS = 330

export const SUPPORTED_NETWORKS = ['mutinynet'] as const
export type VaultNetwork = (typeof SUPPORTED_NETWORKS)[number]

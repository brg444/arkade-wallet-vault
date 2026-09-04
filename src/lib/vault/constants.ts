export const POLICY_VERSION = 'vault-spending-policy-v1'

export const TX_RECIPIENT_CAP_SATS = 50_000
export const PERIOD_ALLOWANCE_SATS = 100_000
export const MUTINYNET_ABSOLUTE_FEE_CEILING_SATS = 5_000
export const MUTINYNET_FEERATE_CEILING_SAT_PER_V = 10
export const MAINNET_ABSOLUTE_FEE_CEILING_SATS = 20_000
export const MAINNET_FEERATE_CEILING_SAT_PER_V = 25

const bakedReleaseNetwork = String(import.meta.env.VITE_VAULT_RELEASE_NETWORK || '').trim()
export const ABSOLUTE_FEE_CEILING_SATS =
  bakedReleaseNetwork === 'mainnet' ? MAINNET_ABSOLUTE_FEE_CEILING_SATS : MUTINYNET_ABSOLUTE_FEE_CEILING_SATS
export const FEERATE_CEILING_SAT_PER_V =
  bakedReleaseNetwork === 'mainnet' ? MAINNET_FEERATE_CEILING_SAT_PER_V : MUTINYNET_FEERATE_CEILING_SAT_PER_V
export const DUST_SATS = 330
// Home renders activity as ordinary accessible buttons, so both fetch and
// presentation stay within a useful recent window instead of growing forever.
export const RECENT_HISTORY_LIMIT = 100

export const SUPPORTED_NETWORKS = ['mutinynet', 'mainnet'] as const
export type VaultNetwork = (typeof SUPPORTED_NETWORKS)[number]

export function isSupportedVaultNetwork(value: unknown): value is VaultNetwork {
  return typeof value === 'string' && (SUPPORTED_NETWORKS as readonly string[]).includes(value)
}

/**
 * Named Vault Programs are network-specific. Each network has frozen delays,
 * Operator identity, and Contract Pack bytes. Wrong-network values fail closed.
 */
export function requireSupportedVaultNetwork(value: unknown): VaultNetwork {
  if (!isSupportedVaultNetwork(value)) throw new Error(`unsupported Vault network ${String(value || '')}`)
  return value
}

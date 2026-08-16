// Pinned to poc/2fa-vault/fixture. Changing these is a new template/policy, not a UI tweak.
export const VAULT_SCHEMA = 'arkade-vault/v3'
export const VAULT_ID = 'operational-vault-v1'
export const TEMPLATE_VERSION = 'phone-direct-p256-routine-3of3-admin-2of2-v3'
export const POLICY_VERSION = 'mandatory-change-tx50k-day100k-fee5k-feerate10-onchain-v3'

export const TX_RECIPIENT_CAP_SATS = 50_000
export const PERIOD_ALLOWANCE_SATS = 100_000
export const ABSOLUTE_FEE_CEILING_SATS = 5_000
export const FEERATE_CEILING_SAT_PER_V = 10
export const DUST_SATS = 330

export const DEFAULT_OPERATIONAL_CSV_BLOCKS = 6
export const DEFAULT_SAVINGS_CSV_BLOCKS = 144

export const WATCH_STORE_KEY = 'arkade-vault-watch-v3'

export const SUPPORTED_NETWORKS = ['regtest', 'mutinynet'] as const
export type VaultNetwork = (typeof SUPPORTED_NETWORKS)[number]

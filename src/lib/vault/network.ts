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

export function configuredReleaseNetwork(value: unknown, production: boolean): VaultNetwork | undefined {
  const configured = String(value || '').trim()
  if (!configured) {
    if (production) throw new Error('Explicit Vault release network required')
    return undefined
  }
  return requireSupportedVaultNetwork(configured)
}

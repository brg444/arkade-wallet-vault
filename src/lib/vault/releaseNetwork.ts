import { requireSupportedVaultNetwork, type VaultNetwork } from './constants'

export function configuredReleaseNetwork(value: unknown, production: boolean): VaultNetwork | undefined {
  const configured = String(value || '').trim()
  if (!configured) return production ? 'mutinynet' : undefined
  return requireSupportedVaultNetwork(configured)
}

export function requireReleaseNetwork(network: unknown): VaultNetwork {
  const actual = requireSupportedVaultNetwork(network)
  const expected = configuredReleaseNetwork(import.meta.env.VITE_VAULT_RELEASE_NETWORK, import.meta.env.PROD)
  if (expected && actual !== expected) throw new Error(`Vault service network does not match the ${expected} release`)
  return actual
}

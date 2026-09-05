import { configuredReleaseNetwork, requireSupportedVaultNetwork, type VaultNetwork } from './network'
export { configuredReleaseNetwork } from './network'

export function requireReleaseNetwork(network: unknown): VaultNetwork {
  const actual = requireSupportedVaultNetwork(network)
  const expected = configuredReleaseNetwork(import.meta.env.VITE_VAULT_RELEASE_NETWORK, import.meta.env.PROD)
  if (expected && actual !== expected) throw new Error(`Vault service network does not match the ${expected} release`)
  return actual
}

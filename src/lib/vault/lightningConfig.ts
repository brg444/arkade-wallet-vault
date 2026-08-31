import type { NetworkName } from '@arkade-os/sdk'

const LIGHTNING_SEND_RELEASE_FLAG = 'true'

export interface VaultLightningSolverProfile {
  network: NetworkName
  pubkey: string
  relays: readonly string[]
  minSats: number
  maxSats: number
}

/** Release-pinned Mutinynet solver. Discovery cannot redirect vault funds. */
export const MUTINYNET_LIGHTNING_SOLVER: VaultLightningSolverProfile = {
  network: 'mutinynet',
  pubkey: '11f0f8a9fd4f24b25a25075dcfc58f84162a75606ddcbe91cd1fe4f4fc737241',
  relays: ['wss://nostr.arkade.sh'],
  minSats: 1_000,
  maxSats: 50_000,
}

export function vaultLightningSendEnabled(value = import.meta.env.VITE_VAULT_LIGHTNING_SEND): boolean {
  return value === LIGHTNING_SEND_RELEASE_FLAG
}

export function isVaultLightningInput(value: string): boolean {
  return /^ln(?:bc|tb|tbs|bcrt)\d/i.test(value.trim().replace(/^lightning:/i, ''))
}

export function vaultLightningSolverProfile(network: NetworkName): VaultLightningSolverProfile | undefined {
  return network === 'mutinynet' ? MUTINYNET_LIGHTNING_SOLVER : undefined
}

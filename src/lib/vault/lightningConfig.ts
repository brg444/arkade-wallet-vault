import type { NetworkName } from '@arkade-os/sdk'

const LIGHTNING_SEND_RELEASE_FLAG = 'true'

export interface VaultLightningSolverProfile {
  network: NetworkName
  pubkey: string
  relays: readonly string[]
  minSats: number
  maxSats: number
  maxFundingSats: number
}

/** Release-pinned Mutinynet solver. Discovery cannot redirect vault funds. */
export const MUTINYNET_LIGHTNING_SOLVER: VaultLightningSolverProfile = {
  network: 'mutinynet',
  pubkey: '3f831510a6d7678d0c90d7d6fbc4057720517e2e30681ef4c87cc57aaf57e8d5',
  relays: ['wss://nostr.arkade.sh'],
  minSats: 1_000,
  maxSats: 25_000,
  maxFundingSats: 50_000,
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

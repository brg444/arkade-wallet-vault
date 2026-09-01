import { browserVaultLockManager, requireVaultLockManager, type VaultLockManager } from './vtxo/lock'

export function vaultLightningLifecycleLockName(vaultId: string): string {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('Vault ID is required for Lightning coordination.')
  return `arkade-vault-lightning:${id}`
}

export async function withVaultLightningLifecycleLock<T>(
  vaultId: string,
  run: () => Promise<T>,
  locks: VaultLockManager | null | undefined = browserVaultLockManager(),
): Promise<T> {
  return requireVaultLockManager(locks).request(
    vaultLightningLifecycleLockName(vaultId),
    { mode: 'exclusive' },
    async (lock) => {
      if (!lock) throw new Error('Web Locks API returned no exclusive Lightning lock')
      return run()
    },
  )
}

export type VaultLightningLockAttempt<T> = { held: false } | { held: true; value: T }

/** Background observers never queue behind an authenticated money-moving operation. */
export async function tryVaultLightningLifecycleLock<T>(
  vaultId: string,
  run: () => Promise<T>,
  locks: VaultLockManager | null | undefined = browserVaultLockManager(),
): Promise<VaultLightningLockAttempt<T>> {
  return requireVaultLockManager(locks).request(
    vaultLightningLifecycleLockName(vaultId),
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => (lock ? { held: true, value: await run() } : { held: false }),
  )
}

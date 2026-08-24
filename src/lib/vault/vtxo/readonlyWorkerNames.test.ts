import { describe, expect, it } from 'vitest'
import {
  vaultReadonlyIntentDatabase,
  vaultReadonlyNamespace,
  vaultReadonlyUpdaterTag,
  vaultReadonlyWalletDatabase,
  vaultReadonlyWorkerPath,
  vaultReadonlyWorkerScope,
} from './readonlyWorkerNames'

describe('readonly Vault wallet namespace', () => {
  it('isolates worker scope, tag and repositories for each vault', async () => {
    const namespace = vaultReadonlyNamespace('vault/a')
    expect(namespace).toMatch(/^[0-9a-f]{32}$/)
    expect(vaultReadonlyWalletDatabase('vault/a')).toBe(`arkade-vault-v2:${namespace}:wallet`)
    expect(vaultReadonlyIntentDatabase('vault/a')).toBe(`arkade-vault-v2:${namespace}:intents`)
    expect(vaultReadonlyWorkerPath('vault/a')).toBe(`/vault-wallet-service-worker.mjs?vault=${namespace}`)
    expect(vaultReadonlyUpdaterTag('vault/a')).toBe(`ARKADE_VAULT_READONLY:${namespace}`)
    expect(vaultReadonlyWorkerScope('vault/a')).not.toBe(vaultReadonlyWorkerScope('vault/b'))
    expect(vaultReadonlyWalletDatabase('vault/a')).not.toBe(vaultReadonlyWalletDatabase('vault/b'))
  })

  it('refuses an unbound worker namespace', () => {
    expect(() => vaultReadonlyWalletDatabase('')).toThrow(/Vault ID/)
  })
})

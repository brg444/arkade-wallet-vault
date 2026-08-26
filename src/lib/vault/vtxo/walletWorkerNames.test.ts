import { describe, expect, it } from 'vitest'
import {
  vaultWalletIntentDatabase,
  vaultWalletNamespace,
  vaultWalletUpdaterTag,
  vaultWalletDatabase,
  vaultWalletWorkerPath,
  vaultWalletWorkerScope,
} from './walletWorkerNames'

describe('Vault wallet namespace', () => {
  it('isolates worker scope, tag and repositories for each vault', async () => {
    const namespace = vaultWalletNamespace('vault/a')
    expect(namespace).toMatch(/^[0-9a-f]{32}$/)
    expect(vaultWalletDatabase('vault/a')).toBe(`arkade-vault-wallet:${namespace}:wallet`)
    expect(vaultWalletIntentDatabase('vault/a')).toBe(`arkade-vault-wallet:${namespace}:intents`)
    expect(vaultWalletWorkerPath('vault/a')).toBe(`/vault-wallet-service-worker.mjs?vault=${namespace}`)
    expect(vaultWalletUpdaterTag('vault/a')).toBe(`ARKADE_VAULT_WALLET:${namespace}`)
    expect(vaultWalletWorkerScope('vault/a')).not.toBe(vaultWalletWorkerScope('vault/b'))
    expect(vaultWalletDatabase('vault/a')).not.toBe(vaultWalletDatabase('vault/b'))
  })

  it('refuses an unbound worker namespace', () => {
    expect(() => vaultWalletDatabase('')).toThrow(/Vault ID/)
  })
})

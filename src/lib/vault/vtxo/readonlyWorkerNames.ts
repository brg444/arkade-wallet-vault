import { sha256 } from '@noble/hashes/sha2.js'
import { hex } from '@scure/base'

function vaultId(value: string) {
  const id = String(value || '').trim()
  if (!id) throw new Error('Vault ID required for readonly wallet storage')
  return id
}

export function vaultReadonlyNamespace(value: string) {
  return hex.encode(sha256(new TextEncoder().encode(vaultId(value)))).slice(0, 32)
}

export function vaultReadonlyWorkerPath(value: string) {
  return `/vault-wallet-service-worker.mjs?vault=${vaultReadonlyNamespace(value)}`
}

export function vaultReadonlyWalletDatabase(value: string) {
  return vaultReadonlyWalletDatabaseForNamespace(vaultReadonlyNamespace(value))
}

export function vaultReadonlyIntentDatabase(value: string) {
  return vaultReadonlyIntentDatabaseForNamespace(vaultReadonlyNamespace(value))
}

export function vaultReadonlyUpdaterTag(value: string) {
  return vaultReadonlyUpdaterTagForNamespace(vaultReadonlyNamespace(value))
}

export function vaultReadonlyWorkerScope(value: string) {
  return `/__vault-wallet/${vaultReadonlyNamespace(value)}/`
}

function requireNamespace(value: string) {
  if (!/^[0-9a-f]{32}$/.test(value)) throw new Error('Invalid Vault readonly namespace')
  return value
}

export function vaultReadonlyWalletDatabaseForNamespace(value: string) {
  return `arkade-vault-v2:${requireNamespace(value)}:wallet`
}

export function vaultReadonlyIntentDatabaseForNamespace(value: string) {
  return `arkade-vault-v2:${requireNamespace(value)}:intents`
}

export function vaultReadonlyUpdaterTagForNamespace(value: string) {
  return `ARKADE_VAULT_READONLY:${requireNamespace(value)}`
}

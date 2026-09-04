import { sha256 } from '@noble/hashes/sha2.js'
import { hex } from '@scure/base'
import { requireSupportedVaultNetwork } from '../constants'

function vaultId(value: string) {
  const id = String(value || '').trim()
  if (!id) throw new Error('Vault ID required for wallet storage')
  return id
}

export function vaultWalletNamespace(value: string) {
  return hex.encode(sha256(new TextEncoder().encode(vaultId(value)))).slice(0, 32)
}

export function vaultWalletWorkerPath(value: string, network?: string) {
  const params = new URLSearchParams({ vault: vaultWalletNamespace(value) })
  if (network) params.set('network', requireSupportedVaultNetwork(network))
  return `/vault-wallet-service-worker.mjs?${params.toString()}`
}

export function vaultWalletDatabase(value: string) {
  return vaultWalletDatabaseForNamespace(vaultWalletNamespace(value))
}

export function vaultWalletIntentDatabase(value: string) {
  return vaultWalletIntentDatabaseForNamespace(vaultWalletNamespace(value))
}

export function vaultWalletUpdaterTag(value: string) {
  return vaultWalletUpdaterTagForNamespace(vaultWalletNamespace(value))
}

export function vaultWalletWorkerScope(value: string) {
  return `/__vault-wallet/${vaultWalletNamespace(value)}/`
}

function requireNamespace(value: string) {
  if (!/^[0-9a-f]{32}$/.test(value)) throw new Error('Invalid Vault wallet namespace')
  return value
}

export function vaultWalletDatabaseForNamespace(value: string) {
  return `arkade-vault-wallet:${requireNamespace(value)}:wallet`
}

export function vaultWalletIntentDatabaseForNamespace(value: string) {
  return `arkade-vault-wallet:${requireNamespace(value)}:intents`
}

export function vaultWalletUpdaterTagForNamespace(value: string) {
  return `ARKADE_VAULT_WALLET:${requireNamespace(value)}`
}

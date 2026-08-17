import { POLICY_VERSION, TEMPLATE_VERSION, VAULT_ID } from './constants'
import type { VaultStatus } from './types'

export function authorizerBase(): string {
  const configured = (import.meta.env.VITE_VAULT_API as string | undefined) || ''
  return configured.replace(/\/$/, '')
}

export function vaultStatusPath(expectedVaultId: string = VAULT_ID): string {
  const id = expectedVaultId || VAULT_ID
  return `/v1/status?vault=${encodeURIComponent(id)}`
}

export async function fetchVaultStatus(signal?: AbortSignal, expectedVaultId: string = VAULT_ID): Promise<VaultStatus> {
  const base = authorizerBase()
  const id = expectedVaultId || VAULT_ID
  const res = await fetch(`${base}${vaultStatusPath(id)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    throw new Error(`authorizer status ${res.status}`)
  }
  const body = (await res.json()) as VaultStatus
  return requireStatusIdentity(body, id)
}

export function parseStatusJson(raw: string, expectedVaultId: string = VAULT_ID): VaultStatus {
  const body = JSON.parse(raw) as VaultStatus
  return requireStatusIdentity(body, expectedVaultId)
}

export function requireStatusIdentity(status: VaultStatus, expectedVaultId: string = VAULT_ID): VaultStatus {
  if (!status || typeof status !== 'object') throw new Error('status is not an object')
  if (!status.vaultId || String(status.vaultId).trim() === '') throw new Error('vault id required')
  if (status.vaultId !== expectedVaultId) throw new Error('status vault id does not match')
  if (status.templateVersion !== TEMPLATE_VERSION) throw new Error('template version is not this release')
  if (status.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  return status
}

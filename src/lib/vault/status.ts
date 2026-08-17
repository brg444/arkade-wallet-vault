import { POLICY_VERSION, TEMPLATE_VERSION } from './constants'
import type { VaultStatus } from './types'

export function authorizerBase(): string {
  const configured = (import.meta.env.VITE_VAULT_API as string | undefined) || ''
  return configured.replace(/\/$/, '')
}

export async function fetchVaultStatus(signal?: AbortSignal): Promise<VaultStatus> {
  const base = authorizerBase()
  const res = await fetch(`${base}/v1/status`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    throw new Error(`authorizer status ${res.status}`)
  }
  const body = (await res.json()) as VaultStatus
  return requireStatusIdentity(body)
}

export function parseStatusJson(raw: string): VaultStatus {
  const body = JSON.parse(raw) as VaultStatus
  return requireStatusIdentity(body)
}

export function requireStatusIdentity(status: VaultStatus): VaultStatus {
  if (!status || typeof status !== 'object') throw new Error('status is not an object')
  if (!status.vaultId || String(status.vaultId).trim() === '') throw new Error('vault id required')
  if (status.templateVersion !== TEMPLATE_VERSION) throw new Error('template version is not this release')
  if (status.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  return status
}

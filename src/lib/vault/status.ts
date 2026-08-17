import { POLICY_VERSION, TEMPLATE_VERSION, VAULT_ID } from './constants'
import type { VaultStatus } from './types'

export function authorizerBase(): string {
  const configured = (import.meta.env.VITE_VAULT_API as string | undefined) || ''
  return configured.replace(/\/$/, '')
}

export type PublicAuthorizerStatus = {
  network: string
  clientOrigin: string
  rpId: string
  templateVersion: string
  policyVersion: string
  operationalCsvBlocks: number
  savingsCsvBlocks: number
  enrollmentMode: string
  enrollmentExpiresAt?: string
}

function requestedVaultId(expectedVaultId: string | undefined, supplied: boolean): string {
  if (!supplied) return VAULT_ID
  const id = String(expectedVaultId ?? '').trim()
  if (!id) throw new Error('vault id required')
  return id
}

export function vaultStatusPath(expectedVaultId?: string): string {
  const id = requestedVaultId(expectedVaultId, arguments.length > 0)
  return `/v1/status?vault=${encodeURIComponent(id)}`
}

export async function fetchPublicStatus(signal?: AbortSignal): Promise<PublicAuthorizerStatus> {
  const base = authorizerBase()
  const res = await fetch(`${base}/v1/status`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    throw new Error(`authorizer status ${res.status}`)
  }
  const body = (await res.json()) as PublicAuthorizerStatus
  if (!body || typeof body !== 'object') throw new Error('status is not an object')
  if ('vaultId' in body && body.vaultId) throw new Error('public status must not name a vault')
  if (body.templateVersion !== TEMPLATE_VERSION) throw new Error('template version is not this release')
  if (body.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  return body
}

export async function fetchVaultStatus(signal?: AbortSignal, expectedVaultId?: string): Promise<VaultStatus> {
  const base = authorizerBase()
  const id = requestedVaultId(expectedVaultId, arguments.length > 1)
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

export function parseStatusJson(raw: string, expectedVaultId?: string): VaultStatus {
  const body = JSON.parse(raw) as VaultStatus
  return requireStatusIdentity(body, requestedVaultId(expectedVaultId, arguments.length > 1))
}

export function requireStatusIdentity(status: VaultStatus, expectedVaultId?: string): VaultStatus {
  const expected = requestedVaultId(expectedVaultId, arguments.length > 1)
  if (!status || typeof status !== 'object') throw new Error('status is not an object')
  if (!status.vaultId || String(status.vaultId).trim() === '') throw new Error('vault id required')
  if (status.vaultId !== expected) throw new Error('status vault id does not match')
  if (status.templateVersion !== TEMPLATE_VERSION) throw new Error('template version is not this release')
  if (status.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  return status
}

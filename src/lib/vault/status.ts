import { readBounded } from './bounded'
import { POLICY_VERSION, VAULT_ID } from './constants'
import { isKnownTemplate, V5_TEMPLATE } from './v5/constants'
import { bindStatusToLocalPin } from './pin'
import type { VaultStatus } from './types'

export function authorizerBase(): string {
  // Production talks same-origin only. A VITE_ value is compiled into the
  // public bundle and is not a secret; CSP also blocks cross-origin connect.
  if (import.meta.env.PROD) return ''
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

function parseJsonObject<T>(raw: string, label: string): T {
  let body: T
  try {
    body = JSON.parse(raw) as T
  } catch {
    throw new Error(`${label} is not JSON`)
  }
  if (!body || typeof body !== 'object') throw new Error(`${label} is not an object`)
  return body
}

export async function fetchPublicStatus(signal?: AbortSignal): Promise<PublicAuthorizerStatus> {
  const base = authorizerBase()
  const res = await fetch(`${base}/v1/status`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  const text = await readBounded(res)
  if (!res.ok) {
    throw new Error(`authorizer status ${res.status}`)
  }
  const body = parseJsonObject<PublicAuthorizerStatus>(text, 'status')
  if ('vaultId' in body && body.vaultId) throw new Error('public status must not name a vault')
  if (!isKnownTemplate(body.templateVersion)) throw new Error('template version is not this release')
  if (body.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  return body
}

export async function pingVaultService(signal?: AbortSignal): Promise<boolean> {
  try {
    await fetchPublicStatus(signal)
    return true
  } catch {
    return false
  }
}

export async function fetchVaultStatus(signal?: AbortSignal, expectedVaultId?: string): Promise<VaultStatus> {
  const base = authorizerBase()
  const id = requestedVaultId(expectedVaultId, arguments.length > 1)
  const res = await fetch(`${base}${vaultStatusPath(id)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  const text = await readBounded(res)
  if (!res.ok) {
    throw new Error(`authorizer status ${res.status}`)
  }
  const body = requireStatusIdentity(parseJsonObject<VaultStatus>(text, 'status'), id)
  if (!body.enrolled) return body
  return bindStatusToLocalPin(body)
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
  if (!isKnownTemplate(status.templateVersion)) throw new Error('template version is not this release')
  if (status.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  const leftover =
    'recoveryKeyPub' in status ? String((status as { recoveryKeyPub?: string }).recoveryKeyPub || '') : ''
  if (status.templateVersion !== V5_TEMPLATE && leftover) {
    throw new Error('template version is not this release')
  }
  return status
}

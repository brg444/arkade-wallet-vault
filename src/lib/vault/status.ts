import { readBounded } from './bounded'
import { POLICY_VERSION } from './constants'
import { SAVINGS_TEMPLATE } from './program/constants'
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
  enrollmentMode: string
  enrollmentExpiresAt?: string
}

function requestedVaultId(expectedVaultId: string): string {
  const id = String(expectedVaultId || '').trim()
  if (!id) throw new Error('vault id required')
  return id
}

export function vaultStatusPath(expectedVaultId: string): string {
  const id = requestedVaultId(expectedVaultId)
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
  if (body.templateVersion !== SAVINGS_TEMPLATE) throw new Error('template version is not this release')
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

export async function fetchVaultStatus(signal: AbortSignal | undefined, expectedVaultId: string): Promise<VaultStatus> {
  const base = authorizerBase()
  const id = requestedVaultId(expectedVaultId)
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

export function parseStatusJson(raw: string, expectedVaultId: string): VaultStatus {
  const body = JSON.parse(raw) as VaultStatus
  return requireStatusIdentity(body, requestedVaultId(expectedVaultId))
}

export function requireStatusIdentity(status: VaultStatus, expectedVaultId: string): VaultStatus {
  const expected = requestedVaultId(expectedVaultId)
  if (!status || typeof status !== 'object') throw new Error('status is not an object')
  if (!status.vaultId || String(status.vaultId).trim() === '') throw new Error('vault id required')
  if (status.vaultId !== expected) throw new Error('status vault id does not match')
  if (status.templateVersion !== SAVINGS_TEMPLATE) throw new Error('template version is not this release')
  if (status.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  if (status.enrolled && (!String(status.savingsAddress || '').trim() || !String(status.savingsScript || '').trim())) {
    throw new Error('enrolled status is missing the Savings descriptor')
  }
  const recoveryPub = String(status.recoveryPub || '').trim()
  const recoveryKeyPub = String(status.recoveryKeyPub || '').trim()
  if (recoveryPub && recoveryKeyPub && recoveryPub !== recoveryKeyPub) {
    throw new Error('status recovery key fields do not match')
  }
  const recovery = recoveryKeyPub || recoveryPub
  return recovery ? { ...status, recoveryPub: recovery, recoveryKeyPub: recovery } : status
}

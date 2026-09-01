import { readBounded } from './bounded'
import { POLICY_VERSION, requireSupportedVaultNetwork } from './constants'
import { SAVINGS_TEMPLATE } from './program/constants'
import { bindStatusToLocalPin } from './pin'
import type { VaultStatus, VaultStatusWire } from './types'
import {
  requireCurrentSpendingPolicyCapabilities,
  spendingPolicyDigest,
  validateSpendingPolicy,
  type SpendingPolicyCapabilities,
} from './spendingPolicy'
import { requireProtectionTierMatchesRecovery } from './protectionTier'

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
  vtxoBoardingProgram?: string
  spendingPolicyCapabilities: SpendingPolicyCapabilities
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
  requireSupportedVaultNetwork(body.network)
  if (body.templateVersion !== SAVINGS_TEMPLATE) throw new Error('template version is not this release')
  if (body.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  body.spendingPolicyCapabilities = requireCurrentSpendingPolicyCapabilities(body.spendingPolicyCapabilities)
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
  return bindStatusToLocalPin(await fetchVaultStatusUnpinned(signal, expectedVaultId))
}

/** Worker-safe status read. Browser pinning remains a page/session concern. */
export async function fetchVaultStatusUnpinned(
  signal: AbortSignal | undefined,
  expectedVaultId: string,
): Promise<VaultStatus> {
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
  const body = requireStatusIdentity(parseJsonObject<VaultStatusWire & { recoveryPub?: string }>(text, 'status'), id)
  return body
}

export function parseStatusJson(raw: string, expectedVaultId: string): VaultStatus {
  const body = JSON.parse(raw) as VaultStatusWire & { recoveryPub?: string }
  return requireStatusIdentity(body, requestedVaultId(expectedVaultId))
}

// Bind the exact wire status to the selected vault and add the wallet-only
// recoveryPub compatibility alias without adding it to VaultStatusWire.
export function requireStatusIdentity(
  status: VaultStatusWire & { recoveryPub?: string },
  expectedVaultId: string,
): VaultStatus {
  const expected = requestedVaultId(expectedVaultId)
  if (!status || typeof status !== 'object') throw new Error('status is not an object')
  if (!status.vaultId || String(status.vaultId).trim() === '') throw new Error('vault id required')
  if (status.vaultId !== expected) throw new Error('status vault id does not match')
  requireSupportedVaultNetwork(status.network)
  if (status.templateVersion !== SAVINGS_TEMPLATE) throw new Error('template version is not this release')
  if (status.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  const selected = validateSpendingPolicy(status.spendingPolicy)
  if (spendingPolicyDigest(selected) !== status.spendingPolicyDigest) {
    throw new Error('status spending policy digest does not match')
  }
  if (
    selected.txRecipientCapSats !== status.txCap ||
    selected.periodAllowanceSats !== status.periodAllowance ||
    selected.absoluteFeeCapSats !== status.absoluteFeeCap ||
    selected.feerateCapSatPerV !== status.feerateCapSatVb
  ) {
    throw new Error('status spending policy does not match limit fields')
  }
  if (status.enrolled && (!String(status.savingsAddress || '').trim() || !String(status.savingsScript || '').trim())) {
    throw new Error('enrolled status is missing the Savings descriptor')
  }
  const recoveryPub = String(status.recoveryPub || '').trim()
  const recoveryKeyPub = String(status.recoveryKeyPub || '').trim()
  if (recoveryPub && recoveryKeyPub && recoveryPub !== recoveryKeyPub) {
    throw new Error('status recovery key fields do not match')
  }
  const recovery = recoveryKeyPub || recoveryPub
  requireProtectionTierMatchesRecovery(status.protectionTier, recovery)
  return (recovery ? { ...status, recoveryPub: recovery, recoveryKeyPub: recovery } : status) as VaultStatus
}

import type { EnrollmentSecrets } from './tenantEnrollment'
import { VAULT_ID } from './constants'

export const ENROLL_STORE = 'arkade-vault-enroll-secrets-v3'
export const SELECTED_VAULT_STORE = 'arkade-vault-selected-v1'
export const ENROLL_STAGE_STORE = 'arkade-vault-enroll-staged-v1'
export const SESSION_LOCK_STORE = 'arkade-vault-session-lock-v1'

function requestedEnrollmentId(vaultId: string | undefined, supplied: boolean): string {
  if (!supplied) return VAULT_ID
  const id = String(vaultId ?? '').trim()
  if (!id) throw new Error('vault id required')
  return id
}

export function enrollmentStoreKey(vaultId?: string): string {
  return `${ENROLL_STORE}:${requestedEnrollmentId(vaultId, arguments.length > 0)}`
}

function parseEnrollment(raw: string | null): EnrollmentSecrets | null {
  if (!raw) return null
  const rec = JSON.parse(raw) as EnrollmentSecrets
  if (!rec.credId || !rec.ciphertext || !rec.phoneRoutineBip340Pub) return null
  return rec
}

function bindEnrollment(rec: EnrollmentSecrets | null, vaultId: string): EnrollmentSecrets | null {
  if (!rec) return null
  if (rec.vaultId && rec.vaultId !== vaultId) {
    throw new Error('enrollment record vault id does not match')
  }
  return { ...rec, vaultId }
}

export function loadEnrollment(storage: Storage = localStorage, vaultId?: string): EnrollmentSecrets | null {
  const id = requestedEnrollmentId(vaultId, arguments.length > 1)
  const namespaced = bindEnrollment(parseEnrollment(storage.getItem(enrollmentStoreKey(id))), id)
  if (namespaced) return namespaced
  if (id === VAULT_ID) return bindEnrollment(parseEnrollment(storage.getItem(ENROLL_STORE)), id)
  return null
}

export function saveEnrollment(rec: EnrollmentSecrets, storage: Storage = localStorage, vaultId?: string) {
  const id =
    arguments.length > 2
      ? requestedEnrollmentId(vaultId, true)
      : rec.vaultId !== undefined
        ? requestedEnrollmentId(rec.vaultId, true)
        : VAULT_ID
  if (rec.vaultId && rec.vaultId !== id) {
    throw new Error('enrollment record vault id does not match')
  }
  storage.setItem(enrollmentStoreKey(id), JSON.stringify({ ...rec, vaultId: id }))
}

export function clearEnrollment(storage: Storage = localStorage, vaultId?: string) {
  const id = requestedEnrollmentId(vaultId, arguments.length > 1)
  storage.removeItem(enrollmentStoreKey(id))
  if (id === VAULT_ID) storage.removeItem(ENROLL_STORE)
}

export function loadSelectedVaultId(storage: Storage = localStorage): string | null {
  const id = String(storage.getItem(SELECTED_VAULT_STORE) || '').trim()
  return id || null
}

export function saveSelectedVaultId(vaultId: string, storage: Storage = localStorage) {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('vault id required')
  storage.setItem(SELECTED_VAULT_STORE, id)
}

export function clearSelectedVaultId(storage: Storage = localStorage) {
  storage.removeItem(SELECTED_VAULT_STORE)
}

export function loadSessionLocked(storage: Storage = localStorage): boolean {
  return storage.getItem(SESSION_LOCK_STORE) === '1'
}

export function setSessionLocked(locked: boolean, storage: Storage = localStorage) {
  if (locked) storage.setItem(SESSION_LOCK_STORE, '1')
  else storage.removeItem(SESSION_LOCK_STORE)
}

export function findStoredEnrollment(storage: Storage = localStorage): EnrollmentSecrets | null {
  const selected = loadSelectedVaultId(storage)
  if (selected) {
    const rec = loadEnrollment(storage, selected)
    if (rec) return rec
  }
  const legacy = loadEnrollment(storage)
  if (legacy) return legacy
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key || !key.startsWith(`${ENROLL_STORE}:`)) continue
    const rec = parseEnrollment(storage.getItem(key))
    if (rec) return bindEnrollment(rec, rec.vaultId || key.slice(ENROLL_STORE.length + 1))
  }
  return null
}

export type StagedEnrollment = EnrollmentSecrets & {
  handle: string
  userHandle: string
  clientDataJSON: string
  authenticatorData: string
  attestationObject: string
  hardwareXOnly: string
  recoveryXOnly?: string
  inviteToken?: string
  descriptorHash?: string
  operationalAddress?: string
  operationalScript?: string
  savingsAddress?: string
}

export function loadStagedEnrollment(storage: Storage = localStorage): StagedEnrollment | null {
  const rec = parseEnrollment(storage.getItem(ENROLL_STAGE_STORE)) as StagedEnrollment | null
  if (!rec?.vaultId || !rec.handle || !rec.credId || !rec.ciphertext) return null
  return rec
}

export function saveStagedEnrollment(rec: StagedEnrollment, storage: Storage = localStorage) {
  const id = String(rec.vaultId || '').trim()
  if (!id) throw new Error('vault id required')
  if (!rec.handle || !rec.credId || !rec.ciphertext) throw new Error('staged enrollment incomplete')
  storage.setItem(ENROLL_STAGE_STORE, JSON.stringify(rec))
  saveSelectedVaultId(id, storage)
}

export function clearStagedEnrollment(storage: Storage = localStorage) {
  storage.removeItem(ENROLL_STAGE_STORE)
}

export function promoteStagedEnrollment(rec: EnrollmentSecrets, storage: Storage = localStorage) {
  const id = String(rec.vaultId || '').trim()
  if (!id) throw new Error('vault id required')
  saveEnrollment(rec, storage, id)
  saveSelectedVaultId(id, storage)
  clearStagedEnrollment(storage)
}

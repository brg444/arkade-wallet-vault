import type { EnrollmentSecrets } from './enroll'
import { VAULT_ID } from './constants'

export const ENROLL_STORE = 'arkade-vault-enroll-secrets-v3'

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

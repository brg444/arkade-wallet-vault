import type { EnrollmentSecrets } from './enroll'
import { VAULT_ID } from './constants'

export const ENROLL_STORE = 'arkade-vault-enroll-secrets-v3'

export function enrollmentStoreKey(vaultId = VAULT_ID): string {
  return `${ENROLL_STORE}:${vaultId || VAULT_ID}`
}

function parseEnrollment(raw: string | null): EnrollmentSecrets | null {
  if (!raw) return null
  const rec = JSON.parse(raw) as EnrollmentSecrets
  if (!rec.credId || !rec.ciphertext || !rec.phoneRoutineBip340Pub) return null
  return rec
}

export function loadEnrollment(storage: Storage = localStorage, vaultId = VAULT_ID): EnrollmentSecrets | null {
  const id = vaultId || VAULT_ID
  const namespaced = parseEnrollment(storage.getItem(enrollmentStoreKey(id)))
  if (namespaced) return namespaced
  if (id === VAULT_ID) return parseEnrollment(storage.getItem(ENROLL_STORE))
  return null
}

export function saveEnrollment(rec: EnrollmentSecrets, storage: Storage = localStorage, vaultId = VAULT_ID) {
  storage.setItem(enrollmentStoreKey(vaultId || VAULT_ID), JSON.stringify(rec))
}

export function clearEnrollment(storage: Storage = localStorage, vaultId = VAULT_ID) {
  const id = vaultId || VAULT_ID
  storage.removeItem(enrollmentStoreKey(id))
  if (id === VAULT_ID) storage.removeItem(ENROLL_STORE)
}

import type { EnrollmentSecrets } from './enroll'

const ENROLL_STORE = 'arkade-vault-enroll-secrets-v3'

export function loadEnrollment(storage: Storage = localStorage): EnrollmentSecrets | null {
  const raw = storage.getItem(ENROLL_STORE)
  if (!raw) return null
  const rec = JSON.parse(raw) as EnrollmentSecrets
  if (!rec.credId || !rec.ciphertext || !rec.phoneRoutineBip340Pub) return null
  return rec
}

export function saveEnrollment(rec: EnrollmentSecrets, storage: Storage = localStorage) {
  storage.setItem(ENROLL_STORE, JSON.stringify(rec))
}

export function clearEnrollment(storage: Storage = localStorage) {
  storage.removeItem(ENROLL_STORE)
}

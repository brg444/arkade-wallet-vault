import { describe, expect, it } from 'vitest'
import {
  clearEnrollment,
  clearSelectedVaultId,
  enrollmentStoreKey,
  loadEnrollment,
  loadSelectedVaultId,
  loadStagedEnrollment,
  promoteStagedEnrollment,
  findStoredEnrollment,
  loadSessionLocked,
  saveEnrollment,
  saveSelectedVaultId,
  saveStagedEnrollment,
  setSessionLocked,
} from './enrollmentStore'
const VAULT_ID = 'vault-test-current'
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key)
    },
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

const sample = {
  vaultId: VAULT_ID,
  credId: 'aa',
  webauthnP256: '02' + 'bb'.repeat(32),
  phoneDirectP256: '03' + 'cc'.repeat(32),
  phoneRoutineBip340Pub: '02' + 'dd'.repeat(32),
  nonce: 'ee'.repeat(12),
  ciphertext: 'ff'.repeat(48),
}

describe('namespaced enrollment store', () => {
  it('does not let a second vault read the first vault secrets', () => {
    const storage = memoryStorage()
    saveEnrollment(sample, storage, VAULT_ID)
    saveEnrollment({ ...sample, vaultId: 'tenant-b', credId: 'bb' }, storage, 'tenant-b')
    expect(loadEnrollment(storage, VAULT_ID)?.credId).toBe('aa')
    expect(loadEnrollment(storage, 'tenant-b')?.credId).toBe('bb')
    expect(storage.getItem(enrollmentStoreKey('tenant-b'))).toContain('bb')
  })

  it('clears only the requested vault', () => {
    const storage = memoryStorage()
    saveEnrollment(sample, storage, VAULT_ID)
    saveEnrollment({ ...sample, vaultId: 'tenant-b', credId: 'bb' }, storage, 'tenant-b')
    clearEnrollment(storage, 'tenant-b')
    expect(loadEnrollment(storage, 'tenant-b')).toBeNull()
    expect(loadEnrollment(storage, VAULT_ID)?.credId).toBe('aa')
  })

  it('rejects a namespaced record whose vaultId does not match the key', () => {
    const storage = memoryStorage()
    storage.setItem(enrollmentStoreKey('tenant-b'), JSON.stringify({ ...sample, vaultId: VAULT_ID }))
    expect(() => loadEnrollment(storage, 'tenant-b')).toThrow(/vault id/)
    expect(() => saveEnrollment({ ...sample, vaultId: VAULT_ID }, storage, 'tenant-b')).toThrow(/vault id/)
  })

  it('rejects an explicit empty vault id', () => {
    const storage = memoryStorage()
    expect(() => loadEnrollment(storage, '')).toThrow(/vault id required/)
    expect(() => saveEnrollment(sample, storage, '')).toThrow(/vault id required/)
    expect(() => enrollmentStoreKey('')).toThrow(/vault id required/)
  })

  it('persists the selected vault id independently of credentials', () => {
    const storage = memoryStorage()
    saveEnrollment({ ...sample, credId: 'bb', vaultId: 'tenant-b' }, storage, 'tenant-b')
    saveSelectedVaultId('tenant-b', storage)
    expect(loadSelectedVaultId(storage)).toBe('tenant-b')
    expect(loadEnrollment(storage, loadSelectedVaultId(storage) || '')?.credId).toBe('bb')
    clearSelectedVaultId(storage)
    expect(loadSelectedVaultId(storage)).toBeNull()
  })

  it('finds a stored enrollment after sign-out without wiping it', () => {
    const storage = memoryStorage()
    saveEnrollment({ ...sample, vaultId: 'tenant-b' }, storage, 'tenant-b')
    saveSelectedVaultId('tenant-b', storage)
    setSessionLocked(true, storage)
    expect(loadSessionLocked(storage)).toBe(true)
    expect(findStoredEnrollment(storage)?.vaultId).toBe('tenant-b')
    setSessionLocked(false, storage)
    expect(loadSessionLocked(storage)).toBe(false)
  })

  it('stages enrollment before finish and promotes it after confirm', () => {
    const storage = memoryStorage()
    saveStagedEnrollment(
      {
        ...sample,
        vaultId: 'tenant-b',
        handle: 'aa',
        userHandle: 'bb',
        clientDataJSON: 'cc',
        authenticatorData: 'dd',
        attestationObject: 'ee',
        hardwareXOnly: '11'.repeat(32),
      },
      storage,
    )
    expect(loadStagedEnrollment(storage)?.vaultId).toBe('tenant-b')
    expect(loadSelectedVaultId(storage)).toBe('tenant-b')
    promoteStagedEnrollment({ ...sample, vaultId: 'tenant-b', credId: 'bb' }, storage)
    expect(loadStagedEnrollment(storage)).toBeNull()
    expect(loadEnrollment(storage, 'tenant-b')?.credId).toBe('bb')
  })
})

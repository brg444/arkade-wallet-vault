import { describe, expect, it } from 'vitest'
import { POLICY_VERSION } from './constants'
import { STAGED_TEMPLATE } from './program/constants'
import {
  addressPinHash,
  addressPinStoreKey,
  bindStatusToLocalPin,
  clearAddressPin,
  loadAddressPin,
  loadStoredAddressPin,
  pinEnrolledStatus,
  pinFromEnrolledStatus,
} from './pin'
import type { VaultStatus } from './types'

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

function sampleStatus(over: Partial<VaultStatus> = {}): VaultStatus {
  return {
    enrolled: true,
    network: 'mutinynet',
    clientOrigin: 'https://vault.example',
    rpId: 'vault.example',
    vaultId: VAULT_ID,
    templateVersion: STAGED_TEMPLATE,
    policyVersion: POLICY_VERSION,
    operationalCsvBlocks: 144,
    savingsCsvBlocks: 6,
    operationalAddress: 'tb1p9llcrjjkzr57py6vffwveztm0hn0hezj7wzrq5mat6nh07j37g4qh8jl0l',
    operationalScript: '5120' + 'aa'.repeat(32),
    savingsAddress: 'tb1ptest',
    savingsExcludesRoutineCosigners: true,
    periodAllowance: 100000,
    periodSpent: 0,
    periodRemaining: 100000,
    txCap: 50000,
    absoluteFeeCap: 5000,
    feerateCapSatVb: 10,
    ...over,
  }
}

function tenantStatus(over: Partial<VaultStatus> = {}): VaultStatus {
  return sampleStatus({
    vaultId: 'tenant-b',
    operationalAddress: 'tb1potheroperationaladdress0000000000000000000000000000000000',
    ...over,
  })
}

describe('local address pin', () => {
  it('does not pin a first enrolled status until the ceremony asks', () => {
    const storage = memoryStorage()
    expect(bindStatusToLocalPin(tenantStatus(), storage).vaultId).toBe('tenant-b')
    expect(loadStoredAddressPin(storage, 'tenant-b')).toBeNull()
    const first = pinEnrolledStatus(tenantStatus(), storage)
    expect(loadStoredAddressPin(storage, 'tenant-b')?.pinHash).toBe(addressPinHash(first))
    expect(() => pinEnrolledStatus(tenantStatus({ operationalAddress: 'tb1pattacker' }), storage)).toThrow(/local pin/)
  })

  it('does not synthesize a pin before enrollment commits one', () => {
    const storage = memoryStorage()
    expect(loadAddressPin(storage, VAULT_ID)).toBeNull()
    expect(loadStoredAddressPin(storage, VAULT_ID)).toBeNull()
    expect(bindStatusToLocalPin(sampleStatus({ operationalAddress: 'tb1pattacker' }), storage).operationalAddress).toBe(
      'tb1pattacker',
    )
  })

  it('does not treat an unenrolled status as a pin', () => {
    const storage = memoryStorage()
    expect(
      bindStatusToLocalPin(tenantStatus({ enrolled: false, operationalAddress: 'tb1pattacker' }), storage),
    ).toMatchObject({
      enrolled: false,
    })
    expect(loadStoredAddressPin(storage, 'tenant-b')).toBeNull()
  })

  it('rejects a tampered stored pin hash', () => {
    const storage = memoryStorage()
    pinEnrolledStatus(tenantStatus(), storage)
    const key = addressPinStoreKey('tenant-b')
    const raw = JSON.parse(storage.getItem(key) || '{}')
    raw.pinHash = 'aa'.repeat(32)
    storage.setItem(key, JSON.stringify(raw))
    expect(() => loadAddressPin(storage, 'tenant-b')).toThrow(/hash/)
  })

  it('namespaces pins by vault id', () => {
    const storage = memoryStorage()
    pinEnrolledStatus(tenantStatus(), storage)
    expect(loadAddressPin(storage, 'tenant-b')?.vaultId).toBe('tenant-b')
  })

  it('clears only the requested vault pin', () => {
    const storage = memoryStorage()
    pinEnrolledStatus(tenantStatus(), storage)
    clearAddressPin(storage, 'tenant-b')
    expect(loadAddressPin(storage, 'tenant-b')).toBeNull()
  })

  it('hashes operational script into the pin', () => {
    const a = pinFromEnrolledStatus(tenantStatus())
    const b = pinFromEnrolledStatus(tenantStatus({ operationalScript: '5120' + 'bb'.repeat(32) }))
    expect(a.pinHash).not.toBe(b.pinHash)
  })
})
const VAULT_ID = 'vault-test-current'

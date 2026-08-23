import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, encodeUtf8 } from './hex'
import type { VaultStatus } from './types'

export const ADDRESS_PIN_STORE = 'arkade-vault-savings-pin-v1'

export type AddressPin = {
  vaultId: string
  pinHash: string
  savingsAddress: string
  savingsScript: string
  pinnedAt: string
}

export type AddressPinFields = {
  vaultId: string
  savingsAddress: string
  savingsScript: string
}

function requestedPinId(vaultId: string): string {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('vault id required')
  return id
}

export function addressPinStoreKey(vaultId: string): string {
  return `${ADDRESS_PIN_STORE}:${requestedPinId(vaultId)}`
}

function appendText(parts: Uint8Array[], value: string, name: string) {
  if (!value || value !== value.trim()) throw new Error(`${name} required`)
  const bytes = encodeUtf8(value)
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, bytes.length, false)
  parts.push(len, bytes)
}

export function addressPinHash(fields: AddressPinFields): string {
  const vaultId = String(fields.vaultId || '').trim()
  if (!vaultId) throw new Error('vault id required')
  const savingsAddress = String(fields.savingsAddress || '').trim()
  if (!savingsAddress) throw new Error('savings address required')
  const savingsScript = String(fields.savingsScript || '').trim()
  if (!savingsScript) throw new Error('savings script required')
  const parts: Uint8Array[] = [encodeUtf8('arkade-vault/savings-pin/v1')]
  appendText(parts, vaultId, 'vaultId')
  appendText(parts, savingsAddress, 'savingsAddress')
  appendText(parts, savingsScript, 'savingsScript')
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return bytesToHex(sha256(out))
}

export function pinFieldsFromStatus(status: VaultStatus): AddressPinFields {
  if (!status?.enrolled) throw new Error('authorizer is not enrolled')
  const vaultId = String(status.vaultId || '').trim()
  if (!vaultId) throw new Error('vault id required')
  return {
    vaultId,
    savingsAddress: String(status.savingsAddress || '').trim(),
    savingsScript: String(status.savingsScript || '').trim(),
  }
}

export function pinFromEnrolledStatus(status: VaultStatus): AddressPin {
  const fields = pinFieldsFromStatus(status)
  return {
    ...fields,
    pinHash: addressPinHash(fields),
    pinnedAt: new Date().toISOString(),
  }
}

export function requireStatusMatchesPin(status: VaultStatus, pin: AddressPin): VaultStatus {
  const fields = pinFieldsFromStatus(status)
  if (addressPinHash(pin) !== pin.pinHash) throw new Error('local address pin hash does not match')
  if (addressPinHash(fields) !== pin.pinHash) {
    throw new Error('status deposit address does not match the local pin')
  }
  return status
}

function requireAddressPin(rec: AddressPin, expectedVaultId: string): AddressPin {
  if (!rec?.pinHash || !rec.savingsAddress || !rec.savingsScript || !rec.pinnedAt) {
    throw new Error('incomplete address pin')
  }
  const vaultId = String(rec.vaultId || '').trim()
  if (vaultId !== expectedVaultId) throw new Error('address pin vault id does not match')
  const hash = addressPinHash(rec)
  if (hash !== rec.pinHash) throw new Error('local address pin hash does not match')
  return { ...rec, vaultId, pinHash: hash }
}

export function loadStoredAddressPin(storage: Storage = localStorage, vaultId = ''): AddressPin | null {
  const id = requestedPinId(vaultId)
  const raw = storage.getItem(addressPinStoreKey(id))
  if (!raw) return null
  return requireAddressPin(JSON.parse(raw) as AddressPin, id)
}

export function loadAddressPin(storage: Storage = localStorage, vaultId = ''): AddressPin | null {
  const id = requestedPinId(vaultId)
  return loadStoredAddressPin(storage, id)
}

export function saveAddressPin(pin: AddressPin, storage: Storage = localStorage): AddressPin {
  const valid = requireAddressPin(pin, String(pin.vaultId || '').trim())
  storage.setItem(addressPinStoreKey(valid.vaultId), JSON.stringify(valid))
  return valid
}

export function clearAddressPin(storage: Storage = localStorage, vaultId = '') {
  const id = requestedPinId(vaultId)
  storage.removeItem(addressPinStoreKey(id))
}

export function bindStatusToLocalPin(status: VaultStatus, storage: Storage = localStorage): VaultStatus {
  if (!status?.enrolled) return status
  const id = String(status.vaultId || '').trim()
  if (!id) throw new Error('vault id required')
  const existing = loadAddressPin(storage, id)
  if (existing) return requireStatusMatchesPin(status, existing)
  return status
}

export function pinEnrolledStatus(status: VaultStatus, storage: Storage = localStorage): AddressPin {
  const existing = loadAddressPin(storage, String(status.vaultId || '').trim())
  if (existing) {
    requireStatusMatchesPin(status, existing)
    return existing
  }
  return saveAddressPin(pinFromEnrolledStatus(status), storage)
}

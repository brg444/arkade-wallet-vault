import { sha256 } from '@noble/hashes/sha2.js'
import { VAULT_ID } from './constants'
import { bytesToHex, encodeUtf8 } from './hex'
import { TRUSTED_KIOSK_PIN_FIELDS } from './kiosk'
import type { VaultStatus } from './types'

export const ADDRESS_PIN_STORE = 'arkade-vault-address-pin-v1'

export type AddressPin = {
  vaultId: string
  pinHash: string
  operationalAddress: string
  operationalScript: string
  savingsAddress: string
  pinnedAt: string
}

export type AddressPinFields = {
  vaultId: string
  operationalAddress: string
  operationalScript: string
  savingsAddress: string
}

function requestedPinId(vaultId: string | undefined, supplied: boolean): string {
  if (!supplied) return VAULT_ID
  const id = String(vaultId ?? '').trim()
  if (!id) throw new Error('vault id required')
  return id
}

export function addressPinStoreKey(vaultId?: string): string {
  return `${ADDRESS_PIN_STORE}:${requestedPinId(vaultId, arguments.length > 0)}`
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
  const operationalAddress = String(fields.operationalAddress || '').trim()
  const operationalScript = String(fields.operationalScript || '').trim()
  const savingsAddress = String(fields.savingsAddress || '').trim()
  if (!operationalAddress) throw new Error('operational address required')
  if (
    !operationalScript ||
    operationalScript !== operationalScript.toLowerCase() ||
    operationalScript.length % 2 !== 0
  ) {
    throw new Error('operational script required')
  }
  if (!savingsAddress) throw new Error('savings address required')
  const parts: Uint8Array[] = [encodeUtf8('arkade-2fa-vault/address-pin/v1')]
  appendText(parts, vaultId, 'vaultId')
  appendText(parts, operationalAddress, 'operationalAddress')
  appendText(parts, operationalScript, 'operationalScript')
  appendText(parts, savingsAddress, 'savingsAddress')
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
    operationalAddress: String(status.operationalAddress || '').trim(),
    operationalScript: String(status.operationalScript || '').trim(),
    savingsAddress: String(status.savingsAddress || '').trim(),
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
  if (!rec?.pinHash || !rec.operationalAddress || !rec.operationalScript || !rec.savingsAddress || !rec.pinnedAt) {
    throw new Error('incomplete address pin')
  }
  const vaultId = String(rec.vaultId || '').trim()
  if (vaultId !== expectedVaultId) throw new Error('address pin vault id does not match')
  const hash = addressPinHash(rec)
  if (hash !== rec.pinHash) throw new Error('local address pin hash does not match')
  return { ...rec, vaultId, pinHash: hash }
}

export function trustedKioskPin(): AddressPin {
  return {
    ...TRUSTED_KIOSK_PIN_FIELDS,
    pinHash: addressPinHash(TRUSTED_KIOSK_PIN_FIELDS),
    pinnedAt: '2026-08-17T00:00:00.000Z',
  }
}

export function loadStoredAddressPin(storage: Storage = localStorage, vaultId?: string): AddressPin | null {
  const id = requestedPinId(vaultId, arguments.length > 1)
  const raw = storage.getItem(addressPinStoreKey(id))
  if (!raw) return null
  return requireAddressPin(JSON.parse(raw) as AddressPin, id)
}

export function loadAddressPin(storage: Storage = localStorage, vaultId?: string): AddressPin | null {
  const id = requestedPinId(vaultId, arguments.length > 1)
  const stored = loadStoredAddressPin(storage, id)
  if (stored) return stored
  if (id === VAULT_ID) return trustedKioskPin()
  return null
}

export function saveAddressPin(pin: AddressPin, storage: Storage = localStorage): AddressPin {
  const valid = requireAddressPin(pin, String(pin.vaultId || '').trim())
  storage.setItem(addressPinStoreKey(valid.vaultId), JSON.stringify(valid))
  return valid
}

export function clearAddressPin(storage: Storage = localStorage, vaultId?: string) {
  const id = requestedPinId(vaultId, arguments.length > 1)
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

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hex } from '@scure/base'
import { createBoardingProgramScript, getNetwork } from '@arkade-os/sdk'
import { bytesToHex, encodeUtf8, hexToBytes, requireLowerHex } from '../hex'
import type { VaultBoardV2Descriptor, VaultStatus } from '../types'
import { vaultReadonlyNamespace } from './readonlyWorkerNames'

export const VAULT_BOARD_V2_PROGRAM = 'vault-board-v2' as const
export const VAULT_BOARD_V2_SCHEMA = 'arkade-vault/board-v2' as const
export const VAULT_BOARD_V2_TEMPLATE = 'vault-board-v2-device-vault-and-operator' as const
export const VAULT_BOARD_V2_EXIT_DELAY = 604_672
export const VAULT_BOARD_V2_EXIT_DELAY_UNIT = 'seconds' as const
export const MUTINYNET_OPERATOR_SIGNER_PUB =
  '03301078808e4f7bc0dadfe29e34b1df8eaf0108ef06b1722274075ebc107a127a' as const

const BOARDING_KEY_DOMAIN = 'vault-board-v2/device-key'
const BOARDING_KEY_SALT = sha256(encodeUtf8('arkade-vault/vault-board-v2/boarding-key/hkdf-sha256-v1'))
const SECP256K1_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')
const KEY_DATABASE_PREFIX = 'arkade-vault-board-v2-key'
const KEY_STORE = 'key'
const KEY_DB_VERSION = 1

export const VAULT_BOARD_V2_PROGRAM_DIGEST = bytesToHex(
  sha256(
    encodeUtf8(
      JSON.stringify({
        schema: VAULT_BOARD_V2_SCHEMA,
        program: VAULT_BOARD_V2_PROGRAM,
        template: VAULT_BOARD_V2_TEMPLATE,
        exitDelay: VAULT_BOARD_V2_EXIT_DELAY,
        exitDelayUnit: VAULT_BOARD_V2_EXIT_DELAY_UNIT,
      }),
    ),
  ),
)

export interface VaultBoardV2KeyRecord {
  state: 'staged' | 'active'
  vaultId: string
  network: 'mutinynet'
  programDigest: string
  descriptorHash: string
  boardingPub: string
  secret: Uint8Array
}

function appendLengthPrefixed(parts: Uint8Array[], value: string) {
  const bytes = encodeUtf8(value)
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, bytes.length, false)
  parts.push(length, bytes)
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function scalarFromBigInt(value: bigint): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(32))
  let remaining = value
  for (let index = out.length - 1; index >= 0; index--) {
    out[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  return out
}

function webCryptoBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

/** Derive the deterministic, even-Y vault-wide worker key without retaining the phone scalar. */
export async function deriveVaultBoardV2Key(
  phoneSecret: Uint8Array,
  vaultId: string,
  network: string,
): Promise<{ secret: Uint8Array; boardingPub: string }> {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('vault id required for vault-board-v2 key')
  if (network !== 'mutinynet') throw new Error('vault-board-v2 is not enabled for this network')
  if (phoneSecret.length !== 32 || !secp256k1.utils.isValidSecretKey(phoneSecret)) {
    throw new Error('recovered phone key is invalid')
  }
  const key = await crypto.subtle.importKey('raw', webCryptoBuffer(phoneSecret), 'HKDF', false, ['deriveBits'])
  for (let counter = 0; counter <= 255; counter++) {
    const parts: Uint8Array[] = []
    appendLengthPrefixed(parts, BOARDING_KEY_DOMAIN)
    appendLengthPrefixed(parts, id)
    appendLengthPrefixed(parts, network)
    appendLengthPrefixed(parts, VAULT_BOARD_V2_PROGRAM_DIGEST)
    const suffix = new Uint8Array(4)
    new DataView(suffix.buffer).setUint32(0, counter, false)
    parts.push(suffix)
    const info = concat(parts)
    let candidate = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: webCryptoBuffer(BOARDING_KEY_SALT),
          info: webCryptoBuffer(info),
        },
        key,
        256,
      ),
    )
    info.fill(0)
    if (!secp256k1.utils.isValidSecretKey(candidate)) {
      candidate.fill(0)
      continue
    }
    let pub = secp256k1.getPublicKey(candidate, true)
    if (pub[0] === 3) {
      const odd = candidate
      candidate = scalarFromBigInt(SECP256K1_ORDER - BigInt(`0x${hex.encode(odd)}`))
      odd.fill(0)
      pub = secp256k1.getPublicKey(candidate, true)
    }
    if (pub[0] !== 2) {
      candidate.fill(0)
      throw new Error('vault-board-v2 key did not normalize to even Y')
    }
    return { secret: candidate, boardingPub: hex.encode(pub) }
  }
  throw new Error('vault-board-v2 key derivation failed')
}

function requireCompressedKey(value: string, name: string): string {
  const key = requireLowerHex(value, name, 33)
  const bytes = hexToBytes(key)
  if ((bytes[0] !== 2 && bytes[0] !== 3) || !secp256k1.utils.isValidPublicKey(bytes, true)) {
    throw new Error(`${name} is not a compressed secp256k1 key`)
  }
  return key
}

export function requireVaultBoardV2Descriptor(
  raw: unknown,
  expected: { vaultId: string; phonePub: string; boardingPub: string; network: string },
): VaultBoardV2Descriptor {
  if (!raw || typeof raw !== 'object') throw new Error('vault-board-v2 descriptor required')
  const descriptor = raw as VaultBoardV2Descriptor
  if (
    descriptor.schema !== VAULT_BOARD_V2_SCHEMA ||
    descriptor.program !== VAULT_BOARD_V2_PROGRAM ||
    descriptor.template !== VAULT_BOARD_V2_TEMPLATE ||
    descriptor.network !== 'mutinynet' ||
    expected.network !== descriptor.network ||
    descriptor.exitDelay !== VAULT_BOARD_V2_EXIT_DELAY ||
    descriptor.exitDelayUnit !== VAULT_BOARD_V2_EXIT_DELAY_UNIT
  ) {
    throw new Error('vault-board-v2 descriptor does not match this release')
  }
  const boardingPub = requireCompressedKey(descriptor.boardingPub, 'boardingPub')
  const recoveryPub = requireCompressedKey(descriptor.recoveryPhonePub, 'recoveryPhonePub')
  const cosignerPub = requireCompressedKey(descriptor.vaultBoardCosignerPub, 'vaultBoardCosignerPub')
  const operatorPub = requireCompressedKey(descriptor.operatorPub, 'operatorPub')
  if (operatorPub !== MUTINYNET_OPERATOR_SIGNER_PUB) {
    throw new Error('vault-board-v2 Operator does not match this release')
  }
  if (
    boardingPub !== expected.boardingPub ||
    recoveryPub !== requireCompressedKey(expected.phonePub, 'phoneBip340Pub')
  ) {
    throw new Error('vault-board-v2 descriptor keys do not match this wallet')
  }
  const xOnly = [boardingPub, recoveryPub, cosignerPub, operatorPub].map((key) => key.slice(2))
  if (new Set(xOnly).size !== xOnly.length) throw new Error('vault-board-v2 roles must use distinct keys')
  const program = createBoardingProgramScript(
    {
      name: VAULT_BOARD_V2_PROGRAM,
      boardingPubKey: hexToBytes(boardingPub).slice(1),
      cosignerPubKey: hexToBytes(cosignerPub).slice(1),
      recoveryPubKey: hexToBytes(recoveryPub).slice(1),
    },
    hexToBytes(MUTINYNET_OPERATOR_SIGNER_PUB).slice(1),
    { type: 'seconds', value: BigInt(VAULT_BOARD_V2_EXIT_DELAY) },
  )
  const script = requireLowerHex(descriptor.script, 'vault-board-v2 script', 34)
  const address = program.onchainAddress(getNetwork('mutinynet'))
  if (hex.encode(program.pkScript) !== script || descriptor.address !== address) {
    throw new Error('vault-board-v2 script or address does not match its exact program')
  }
  return descriptor
}

export function requireVaultBoardV2Status(status: VaultStatus, expectedBoardingPub: string): VaultBoardV2Descriptor {
  if (status.vtxoBoardingProgram !== VAULT_BOARD_V2_PROGRAM || !status.vtxoBoardingActive) {
    throw new Error('vault is not enrolled for vault-board-v2')
  }
  const descriptor = requireVaultBoardV2Descriptor(status.vtxoBoardingDescriptor, {
    vaultId: status.vaultId,
    phonePub: String(status.phoneBip340Pub || ''),
    boardingPub: expectedBoardingPub,
    network: status.network,
  })
  if (
    descriptor.script !== String(status.vtxoBoardingScript || '').toLowerCase() ||
    descriptor.address !== status.vtxoBoardingAddress ||
    descriptor.exitDelay !== status.vtxoBoardingExitDelay ||
    descriptor.exitDelayUnit !== status.vtxoBoardingExitDelayUnit
  ) {
    throw new Error('vault-board-v2 status descriptor changed')
  }
  if (!status.vtxoBoardingDescriptorHash || !/^[0-9a-f]{64}$/.test(status.vtxoBoardingDescriptorHash)) {
    throw new Error('vault-board-v2 descriptor hash required')
  }
  return descriptor
}

function databaseName(vaultId: string) {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('vault id required')
  return databaseNameForNamespace(vaultReadonlyNamespace(id))
}

function databaseNameForNamespace(namespace: string) {
  if (!/^[0-9a-f]{32}$/.test(namespace)) throw new Error('vault-board-v2 namespace is invalid')
  return `${KEY_DATABASE_PREFIX}:${namespace}`
}

function openKeyDatabaseForName(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, KEY_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('vault-board-v2 key database unavailable'))
  })
}

function openKeyDatabase(vaultId: string): Promise<IDBDatabase> {
  return openKeyDatabaseForName(databaseName(vaultId))
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('vault-board-v2 key operation failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('vault-board-v2 key transaction aborted'))
    transaction.onerror = () => reject(transaction.error || new Error('vault-board-v2 key transaction failed'))
  })
}

export async function stageVaultBoardV2Key(input: {
  vaultId: string
  phoneSecret: Uint8Array
  network: string
  descriptorHash?: string
}): Promise<Omit<VaultBoardV2KeyRecord, 'state'>> {
  const derived = await deriveVaultBoardV2Key(input.phoneSecret, input.vaultId, input.network)
  const record: Omit<VaultBoardV2KeyRecord, 'state'> = {
    vaultId: input.vaultId,
    network: 'mutinynet',
    programDigest: VAULT_BOARD_V2_PROGRAM_DIGEST,
    descriptorHash: String(input.descriptorHash || ''),
    boardingPub: derived.boardingPub,
    secret: derived.secret,
  }
  const db = await openKeyDatabase(input.vaultId)
  try {
    const transaction = db.transaction(KEY_STORE, 'readwrite')
    transaction.objectStore(KEY_STORE).put({ ...record, state: 'staged' } satisfies VaultBoardV2KeyRecord, 'staged')
    await transactionDone(transaction)
  } finally {
    db.close()
    derived.secret.fill(0)
  }
  return { ...record, secret: new Uint8Array(0) }
}

export async function activateVaultBoardV2Key(input: {
  vaultId: string
  descriptorHash: string
  expectedBoardingPub: string
}): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(input.descriptorHash)) throw new Error('vault-board-v2 descriptor hash required')
  const db = await openKeyDatabase(input.vaultId)
  try {
    const transaction = db.transaction(KEY_STORE, 'readwrite')
    const store = transaction.objectStore(KEY_STORE)
    const staged = (await requestResult(store.get('staged'))) as VaultBoardV2KeyRecord | undefined
    if (!staged || staged.vaultId !== input.vaultId || staged.programDigest !== VAULT_BOARD_V2_PROGRAM_DIGEST) {
      transaction.abort()
      throw new Error('staged vault-board-v2 key required')
    }
    if (staged.boardingPub !== input.expectedBoardingPub) {
      staged.secret.fill(0)
      transaction.abort()
      throw new Error('staged vault-board-v2 key does not match descriptor')
    }
    store.put({ ...staged, state: 'active', descriptorHash: input.descriptorHash }, 'active')
    store.delete('staged')
    await transactionDone(transaction)
    staged.secret.fill(0)
  } finally {
    db.close()
  }
}

export async function provisionVaultBoardV2Key(phoneSecret: Uint8Array, status: VaultStatus): Promise<void> {
  if (status.vtxoBoardingProgram !== VAULT_BOARD_V2_PROGRAM) return
  const staged = await stageVaultBoardV2Key({
    vaultId: status.vaultId,
    phoneSecret,
    network: status.network,
    descriptorHash: status.vtxoBoardingDescriptorHash,
  })
  requireVaultBoardV2Status(status, staged.boardingPub)
  await activateVaultBoardV2Key({
    vaultId: status.vaultId,
    descriptorHash: String(status.vtxoBoardingDescriptorHash || ''),
    expectedBoardingPub: staged.boardingPub,
  })
}

export async function loadActiveVaultBoardV2Key(vaultId: string): Promise<VaultBoardV2KeyRecord> {
  return loadActiveVaultBoardV2KeyFromDatabase(await openKeyDatabase(vaultId), vaultId)
}

export async function loadActiveVaultBoardV2KeyForNamespace(namespace: string): Promise<VaultBoardV2KeyRecord> {
  return loadActiveVaultBoardV2KeyFromDatabase(await openKeyDatabaseForName(databaseNameForNamespace(namespace)))
}

async function loadActiveVaultBoardV2KeyFromDatabase(
  db: IDBDatabase,
  expectedVaultId?: string,
): Promise<VaultBoardV2KeyRecord> {
  try {
    const transaction = db.transaction(KEY_STORE, 'readonly')
    const record = (await requestResult(transaction.objectStore(KEY_STORE).get('active'))) as
      | VaultBoardV2KeyRecord
      | undefined
    await transactionDone(transaction)
    if (
      !record ||
      record.state !== 'active' ||
      (expectedVaultId && record.vaultId !== expectedVaultId) ||
      record.secret.length !== 32
    ) {
      throw new Error('active vault-board-v2 key required')
    }
    return { ...record, secret: record.secret.slice() }
  } finally {
    db.close()
  }
}

export async function deleteVaultBoardV2Key(vaultId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName(vaultId))
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error('vault-board-v2 key deletion failed'))
    request.onblocked = () => reject(new Error('vault-board-v2 key deletion was blocked'))
  })
}

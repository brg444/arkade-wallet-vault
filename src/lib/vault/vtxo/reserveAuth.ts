import { schnorr } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'

const encoder = new TextEncoder()
export const VTXO_RESERVE_TAG = 'arkade-vault/vtxo-reserve/v1'
export const VTXO_ABORT_TAG = 'arkade-vault/vtxo-abort/v1'
const VTXO_RESERVE_VERSION = 1
const VTXO_RESERVE_PURPOSE = 'spend'

export interface VtxoReserveDigestInput {
  operationId: string
  vaultId: string
  destScript: Uint8Array
  amountSats: number
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function uint32LE(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error('uint32 out of range')
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function uint64LE(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('amount is not a safe uint64')
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true)
  return out
}

function field(value: Uint8Array): Uint8Array {
  return concat(uint32LE(value.length), value)
}

function operationBytes(operationId: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/.test(operationId)) throw new Error('invalid VTXO operation id')
  return hex.decode(operationId)
}

/** Canonical wallet/server digest for authenticating reservation creation. */
export function vtxoReserveDigest(input: VtxoReserveDigestInput): Uint8Array {
  const vaultId = encoder.encode(input.vaultId)
  if (vaultId.length === 0) throw new Error('vault id required')
  if (input.destScript.length === 0) throw new Error('destination script required')
  const payload = concat(
    uint32LE(VTXO_RESERVE_VERSION),
    field(operationBytes(input.operationId)),
    field(vaultId),
    field(encoder.encode(VTXO_RESERVE_PURPOSE)),
    field(input.destScript),
    uint64LE(input.amountSats),
  )
  return schnorr.utils.taggedHash(VTXO_RESERVE_TAG, payload)
}

export function signVtxoReserveDigest(
  input: VtxoReserveDigestInput,
  phoneSecret: Uint8Array,
  auxRand?: Uint8Array,
): Uint8Array {
  if (phoneSecret.length !== 32) throw new Error('phone private key must be 32 bytes')
  if (auxRand && auxRand.length !== 32) throw new Error('BIP340 auxiliary randomness must be 32 bytes')
  return schnorr.sign(vtxoReserveDigest(input), phoneSecret, auxRand)
}

export function verifyVtxoReserveSignature(
  input: VtxoReserveDigestInput,
  phoneSignature: string,
  phonePub: Uint8Array,
): boolean {
  if (!/^[0-9a-f]{128}$/.test(phoneSignature) || phonePub.length !== 32) return false
  return schnorr.verify(hex.decode(phoneSignature), vtxoReserveDigest(input), phonePub)
}

export interface VtxoAbortDigestInput {
  operationId: string
  vaultId: string
}

export function vtxoAbortDigest(input: VtxoAbortDigestInput): Uint8Array {
  const vaultId = encoder.encode(input.vaultId)
  if (vaultId.length === 0) throw new Error('vault id required')
  const payload = concat(
    uint32LE(VTXO_RESERVE_VERSION),
    field(operationBytes(input.operationId)),
    field(vaultId),
    field(encoder.encode(VTXO_RESERVE_PURPOSE)),
  )
  return schnorr.utils.taggedHash(VTXO_ABORT_TAG, payload)
}

export function signVtxoAbortDigest(
  input: VtxoAbortDigestInput,
  phoneSecret: Uint8Array,
  auxRand?: Uint8Array,
): Uint8Array {
  if (phoneSecret.length !== 32) throw new Error('phone private key must be 32 bytes')
  if (auxRand && auxRand.length !== 32) throw new Error('BIP340 auxiliary randomness must be 32 bytes')
  return schnorr.sign(vtxoAbortDigest(input), phoneSecret, auxRand)
}

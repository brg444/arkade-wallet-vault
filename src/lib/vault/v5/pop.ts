import { schnorr } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { encodeUtf8, hexToBytes, requireLowerHex } from '../hex'
import { xOnlyFromCompressed } from '../savingsTree'
import { V5_RECOVERY_POP_TAG, V5_TEMPLATE } from './constants'
import { taggedHash } from './context'

function appendBytes(parts: Uint8Array[], bytes: Uint8Array) {
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, bytes.length, false)
  parts.push(len, bytes)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function encodeRecoveryPoP(input: {
  vaultId: string
  inviteHandle: string
  recoveryXOnly: string
  descriptorHash: string
  templateVersion?: string
}): Uint8Array {
  const vaultId = input.vaultId.trim().toLowerCase()
  const invite = input.inviteHandle.trim()
  const template = input.templateVersion || V5_TEMPLATE
  if (!vaultId) throw new Error('vault id required')
  if (!invite) throw new Error('invite handle required')
  if (template !== V5_TEMPLATE && template !== 'phone-hww-recovery-staged-v6') {
    throw new Error('template version is not this release')
  }
  const recovery = requireLowerHex(input.recoveryXOnly, 'recoveryXOnly', 32)
  const descriptorHash = requireLowerHex(input.descriptorHash, 'descriptorHash', 32)
  const parts: Uint8Array[] = []
  appendBytes(parts, encodeUtf8(vaultId))
  appendBytes(parts, encodeUtf8(invite))
  appendBytes(parts, hexToBytes(recovery))
  appendBytes(parts, hexToBytes(descriptorHash))
  appendBytes(parts, encodeUtf8(template))
  return concat(parts)
}

/** 32-byte BIP340 message. Sign with the recovery key. */
export function recoveryPoPDigest(input: {
  vaultId: string
  inviteHandle: string
  recoveryXOnly: string
  descriptorHash: string
  templateVersion?: string
}): Uint8Array {
  return taggedHash(V5_RECOVERY_POP_TAG, encodeRecoveryPoP(input))
}

export function signRecoveryPoP(secret: Uint8Array, digest: Uint8Array): Uint8Array {
  if (digest.length !== 32) throw new Error('recovery PoP digest must be 32 bytes')
  return schnorr.sign(digest, secret)
}

export function verifyRecoveryPoP(signature: Uint8Array, digest: Uint8Array, recoveryPub: string): boolean {
  if (digest.length !== 32 || signature.length !== 64) return false
  const xonly =
    recoveryPub.length === 64
      ? requireLowerHex(recoveryPub, 'recovery', 32)
      : hex.encode(xOnlyFromCompressed(recoveryPub))
  return schnorr.verify(signature, digest, hexToBytes(xonly))
}

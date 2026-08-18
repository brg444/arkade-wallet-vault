import { secp256k1 } from '@noble/curves/secp256k1.js'
import { TEST_NETWORK, WIF } from '@scure/btc-signer'
import { bytesToHex, hexToBytes } from '../hex'
import { xOnly } from '../setupPlan'
import { V5_SCHEMA } from './constants'
import { hashV5Descriptor, recoveryXOnly, validateV5Descriptor, type V5PublicDescriptor } from './descriptor'
import { recoveryPoPDigest, signRecoveryPoP } from './pop'

export function parseRecoverySecret(raw: string): Uint8Array {
  const trimmed = raw.trim()
  const hex = trimmed.toLowerCase().replace(/^0x/, '')
  if (/^[0-9a-f]{64}$/.test(hex)) {
    const bytes = hexToBytes(hex)
    try {
      secp256k1.getPublicKey(bytes, true)
    } catch {
      throw new Error('recovery secret is not a valid key')
    }
    return bytes
  }
  try {
    return WIF(TEST_NETWORK).decode(trimmed)
  } catch {
    throw new Error('recovery secret must be 64-char hex or WIF')
  }
}

export function recoverySecretMatches(secret: Uint8Array, recoveryPub: string): boolean {
  const pub = bytesToHex(secp256k1.getPublicKey(secret, true))
  return xOnly(pub) === xOnly(recoveryPub)
}

export function proposedSchema(raw: unknown): string {
  return raw && typeof raw === 'object' ? String((raw as { schema?: string }).schema || '') : ''
}

export function requireV5ProposedDescriptor(raw: unknown, proposedHash: string): V5PublicDescriptor {
  if (proposedSchema(raw) !== V5_SCHEMA) throw new Error('enroll needs a v5 vault')
  const descriptor = validateV5Descriptor(raw as V5PublicDescriptor)
  const hash = hashV5Descriptor(descriptor)
  if (hash !== proposedHash) throw new Error('proposed descriptor hash does not match this client')
  return descriptor
}

export function signEnrollmentRecoveryPoP(input: {
  descriptor: V5PublicDescriptor
  inviteHandle: string
  recoverySecret: Uint8Array
}): { descriptorHash: string; recoveryXOnly: string; recoveryPoP: string } {
  if (!input.descriptor.keys.recovery) throw new Error('recovery key required')
  if (!recoverySecretMatches(input.recoverySecret, input.descriptor.keys.recovery)) {
    throw new Error('recovery secret does not match the public key')
  }
  const descriptorHash = hashV5Descriptor(input.descriptor)
  const recovery = recoveryXOnly(input.descriptor)
  const digest = recoveryPoPDigest({
    vaultId: input.descriptor.vaultId,
    inviteHandle: input.inviteHandle,
    recoveryXOnly: recovery,
    descriptorHash,
  })
  return {
    descriptorHash,
    recoveryXOnly: recovery,
    recoveryPoP: bytesToHex(signRecoveryPoP(input.recoverySecret, digest)),
  }
}

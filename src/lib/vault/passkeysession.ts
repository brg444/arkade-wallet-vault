import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { verifyDirectP256 } from './ceremony/directauth.js'
import { bytesToHex, hexToBytes } from './hex'
import type { EnrollmentSecrets } from './enroll'
import type { VaultStatus } from './types'

const encoder = new TextEncoder()
const BINDING_DOMAIN = encoder.encode('arkade-2fa-vault/recovery-binding/v1')
const PROOF_DOMAIN = encoder.encode('arkade-2fa-vault/passkey-proof/v1')
const ZERO = Uint8Array.of(0)

export type AccessMode = 'closed' | 'setup' | 'resume' | 'ready' | 'enable' | 'signin'

export function accessMode(
  status: Pick<VaultStatus, 'enrolled' | 'enrollmentMode' | 'passkeyLoginAvailable'> | null,
  { hasLocal = false, hasPending = false } = {},
): AccessMode {
  if (!status?.enrolled) {
    const mode = status?.enrollmentMode
    if (mode && mode !== 'open' && mode !== 'token') return 'closed'
    return hasPending ? 'resume' : 'setup'
  }
  if (hasLocal) return status.passkeyLoginAvailable ? 'ready' : 'enable'
  if (hasPending) return 'resume'
  return 'signin'
}

export function passkeyProofDigest(purpose: string, challenge: Uint8Array, credentialId: Uint8Array): Uint8Array {
  if (purpose !== 'recover' && purpose !== 'install-envelope') {
    throw new Error('invalid passkey purpose')
  }
  return sha256(concat(PROOF_DOMAIN, ZERO, encoder.encode(purpose), ZERO, challenge, ZERO, credentialId))
}

export function recoveryBindingDigest(binding: string): Uint8Array {
  if (!binding || binding.length > 16 * 1024) throw new Error('recovery binding')
  return sha256(concat(BINDING_DOMAIN, ZERO, encoder.encode(binding)))
}

export function parseRecoveryBinding(binding: string): Record<string, string | number> {
  if (!binding || binding.length > 16 * 1024) throw new Error('recovery binding')
  const value = JSON.parse(binding) as Record<string, string | number>
  const expected = [
    'version',
    'credentialId',
    'webauthnP256',
    'phoneDirectP256',
    'phoneRoutineBip340Pub',
    'externalOwnerWalletPub',
    'recoveryKeyPub',
    'vaultCosignerBasePub',
    'tweakedVaultCosignerXOnly',
    'arkadeCosignerBasePub',
    'tweakedArkadeCosignerXOnly',
    'arkadeCosignerOrigin',
    'arkadeCosignerVersion',
    'clientOrigin',
    'rpId',
    'network',
    'vaultId',
    'templateVersion',
    'policyVersion',
    'operationalCsvType',
    'operationalCsvValue',
    'savingsCsvType',
    'savingsCsvValue',
    'operationalAddress',
    'operationalScript',
    'savingsAddress',
    'savingsScript',
    'recipientDustSats',
    'txRecipientCapSats',
    'periodAllowanceSats',
    'absoluteFeeCapSats',
    'feerateCapSatVb',
    'envelopeNonce',
    'envelopeCiphertext',
  ]
  const got = Object.keys(value || {})
  if (got.length !== expected.length || expected.some((field, i) => got[i] !== field)) {
    throw new Error('recovery binding fields or order')
  }
  if (value.version !== 1) throw new Error('recovery binding version')
  return value
}

export function assertRecoveryBindingMatchesStatus(
  binding: string | Record<string, string | number>,
  status: VaultStatus,
) {
  const value = typeof binding === 'string' ? parseRecoveryBinding(binding) : binding
  const pairs: [string, keyof VaultStatus][] = [
    ['phoneDirectP256', 'phoneDirectP256'],
    ['phoneRoutineBip340Pub', 'phoneRoutineBip340Pub'],
    ['externalOwnerWalletPub', 'externalOwnerWalletPub'],
    ['recoveryKeyPub', 'recoveryKeyPub'],
    ['vaultCosignerBasePub', 'vaultCosignerBasePub'],
    ['tweakedVaultCosignerXOnly', 'tweakedVaultCosignerXOnly'],
    ['arkadeCosignerBasePub', 'arkadeCosignerBasePub'],
    ['tweakedArkadeCosignerXOnly', 'tweakedArkadeCosignerXOnly'],
    ['arkadeCosignerOrigin', 'arkadeCosignerOrigin'],
    ['arkadeCosignerVersion', 'arkadeCosignerVersion'],
    ['clientOrigin', 'clientOrigin'],
    ['rpId', 'rpId'],
    ['network', 'network'],
    ['vaultId', 'vaultId'],
    ['templateVersion', 'templateVersion'],
    ['policyVersion', 'policyVersion'],
    ['operationalCsvValue', 'operationalCsvBlocks'],
    ['savingsCsvValue', 'savingsCsvBlocks'],
    ['operationalAddress', 'operationalAddress'],
    ['operationalScript', 'operationalScript'],
    ['savingsAddress', 'savingsAddress'],
    ['txRecipientCapSats', 'txCap'],
    ['periodAllowanceSats', 'periodAllowance'],
    ['absoluteFeeCapSats', 'absoluteFeeCap'],
    ['feerateCapSatVb', 'feerateCapSatVb'],
  ]
  for (const [bindingField, statusField] of pairs) {
    if (String(value[bindingField] ?? '') !== String(status[statusField] ?? '')) {
      throw new Error('recovery binding ' + bindingField + ' does not match vault status')
    }
  }
  return value
}

export function verifyRecoveryBindingSignatures(input: {
  binding: string
  bindingDigestHex: string
  bindingDirectSigHex: string
  bindingPhoneSigHex: string
  derivedDirectPub: Uint8Array
  phoneRoutineSecret: Uint8Array
}) {
  const value = parseRecoveryBinding(input.binding)
  const digest = recoveryBindingDigest(input.binding)
  if (bytesToHex(digest) !== input.bindingDigestHex) throw new Error('recovery binding digest mismatch')
  if (bytesToHex(input.derivedDirectPub) !== value.phoneDirectP256) {
    throw new Error('passkey PRF derived a different DirectP256 identity')
  }
  if (!verifyDirectP256(input.derivedDirectPub, digest, hexToBytes(input.bindingDirectSigHex))) {
    throw new Error('recovery binding DirectP256 signature invalid')
  }
  const derivedPhone = secp256k1.getPublicKey(input.phoneRoutineSecret, true)
  if (bytesToHex(derivedPhone) !== value.phoneRoutineBip340Pub) {
    throw new Error('recovered PhoneRoutine key does not match enrollment')
  }
  if (!schnorr.verify(hexToBytes(input.bindingPhoneSigHex), digest, derivedPhone.slice(1))) {
    throw new Error('recovery binding PhoneRoutine signature invalid')
  }
  return value
}

export function recordFromRecoveryBinding(value: Record<string, string | number>): EnrollmentSecrets {
  const vaultId = String(value.vaultId || '').trim()
  if (!vaultId) throw new Error('vault id required')
  return {
    vaultId,
    credId: String(value.credentialId),
    webauthnP256: String(value.webauthnP256),
    phoneDirectP256: String(value.phoneDirectP256),
    phoneRoutineBip340Pub: String(value.phoneRoutineBip340Pub),
    nonce: String(value.envelopeNonce),
    ciphertext: String(value.envelopeCiphertext),
  }
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const part of parts) {
    out.set(part, off)
    off += part.length
  }
  return out
}

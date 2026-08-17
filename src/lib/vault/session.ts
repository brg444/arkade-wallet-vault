import { schnorr } from '@noble/curves/secp256k1.js'
import { vaultPost } from './api'
import { deriveDirectP256, signDirectP256, zeroBytes } from './ceremony/directauth.js'
import type { EnrollmentSecrets } from './enroll'
import { bytesToHex, hexToBytes } from './hex'
import {
  assertRecoveryBindingMatchesStatus,
  parseRecoveryBinding,
  passkeyProofDigest,
  recordFromRecoveryBinding,
  recoveryBindingDigest,
  verifyRecoveryBindingSignatures,
} from './passkeysession'
import { fetchVaultStatus } from './status'
import type { VaultStatus } from './types'
import { allowPasskey, isCoarsePhone, passkeyGetOptions, prfExtension, prfFrom } from './webauthn'

const PRF_SALT = new TextEncoder().encode('arkade-2fa-vault/prf/v1')
const HKDF_INFO = new TextEncoder().encode('arkade-2fa-vault/kek/v1')

function requireRPID(status: VaultStatus): string {
  const rpId = String(status.rpId || '').toLowerCase()
  if (!rpId || rpId !== location.hostname.toLowerCase()) {
    throw new Error('deployment RP ID does not match this signing client host')
  }
  if (status.clientOrigin !== location.origin) {
    throw new Error('deployment origin does not match this signing client origin')
  }
  return rpId
}

async function deriveKEK(prf: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO },
    await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function beginPasskeySession(
  purpose: 'recover' | 'install-envelope',
  status: VaultStatus,
  allowCredentialId?: string,
) {
  const issued = await vaultPost<{ challengeId: string; challenge: string; allowCredentialId?: string }>(
    '/v1/passkey/challenge',
    { purpose, vaultId: status.vaultId },
  )
  const challenge = hexToBytes(issued.challenge)
  if (challenge.length !== 32) throw new Error('authorizer returned a malformed passkey challenge')
  const expectedCred = allowCredentialId || issued.allowCredentialId
  if (allowCredentialId && issued.allowCredentialId && allowCredentialId !== issued.allowCredentialId) {
    throw new Error('passkey credential does not match this vault')
  }
  const mode = purpose === 'install-envelope' || isCoarsePhone() ? 'local' : 'hybrid'
  const publicKey = passkeyGetOptions(
    {
      challenge: challenge as BufferSource,
      rpId: requireRPID(status),
      userVerification: 'required',
      extensions: prfExtension(PRF_SALT, expectedCred ? hexToBytes(expectedCred) : undefined),
      allowCredentials: expectedCred ? [allowPasskey(hexToBytes(expectedCred), mode)] : undefined,
    },
    mode,
  )
  let got: PublicKeyCredential | null
  try {
    got = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    if (mode === 'hybrid' && expectedCred && (name === 'NotAllowedError' || name === 'InvalidStateError')) {
      throw new Error('this browser does not have the passkey that created this vault')
    }
    throw err
  }
  if (!got) throw new Error('The operation was aborted.')
  if (expectedCred && bytesToHex(new Uint8Array(got.rawId)) !== expectedCred) {
    throw new Error('passkey credential does not match this vault')
  }
  const prf = prfFrom(got)
  if (!prf || prf.length !== 32) {
    throw new Error('this passkey did not return its 32-byte PRF secret on this device')
  }
  const derived = await deriveDirectP256(prf)
  const credentialId = new Uint8Array(got.rawId)
  const response = got.response as AuthenticatorAssertionResponse
  const directProof = signDirectP256(derived.scalar, passkeyProofDigest(purpose, challenge, credentialId))
  return {
    prf,
    scalar: derived.scalar,
    derivedDirectPub: derived.pub,
    credentialId,
    assertion: {
      challengeId: issued.challengeId,
      credentialId: bytesToHex(credentialId),
      clientDataJSON: bytesToHex(new Uint8Array(response.clientDataJSON)),
      authenticatorData: bytesToHex(new Uint8Array(response.authenticatorData)),
      signature: bytesToHex(new Uint8Array(response.signature)),
      directProof: bytesToHex(directProof),
    },
  }
}

export async function enablePasskeyLogin(rec: EnrollmentSecrets): Promise<VaultStatus> {
  let session: Awaited<ReturnType<typeof beginPasskeySession>> | undefined
  let phoneRoutineSecret: Uint8Array | undefined
  try {
    const vaultId = rec.vaultId
    if (!vaultId) throw new Error('vault id required')
    const status = await fetchVaultStatus(undefined, vaultId)
    if (!status.enrolled) throw new Error('vault is not enrolled')
    session = await beginPasskeySession('install-envelope', status, rec.credId)
    const kek = await deriveKEK(session.prf)
    phoneRoutineSecret = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(rec.nonce) }, kek, hexToBytes(rec.ciphertext)),
    )
    const bindingResponse = await vaultPost<{ binding: string; bindingDigest: string }>('/v1/passkey/binding', {
      vaultId: status.vaultId,
      envelopeNonce: rec.nonce,
      envelopeCiphertext: rec.ciphertext,
    })
    assertRecoveryBindingMatchesStatus(bindingResponse.binding, status)
    const digest = recoveryBindingDigest(bindingResponse.binding)
    if (bytesToHex(digest) !== bindingResponse.bindingDigest) {
      throw new Error('server recovery binding digest mismatch')
    }
    const bindingDirectSig = signDirectP256(session.scalar, digest)
    const bindingPhoneSig = schnorr.sign(digest, phoneRoutineSecret)
    verifyRecoveryBindingSignatures({
      binding: bindingResponse.binding,
      bindingDigestHex: bindingResponse.bindingDigest,
      bindingDirectSigHex: bytesToHex(bindingDirectSig),
      bindingPhoneSigHex: bytesToHex(bindingPhoneSig),
      derivedDirectPub: session.derivedDirectPub,
      phoneRoutineSecret,
    })
    await vaultPost('/v1/passkey/install', {
      vaultId,
      challengeId: session.assertion.challengeId,
      credentialId: session.assertion.credentialId,
      clientDataJSON: session.assertion.clientDataJSON,
      authenticatorData: session.assertion.authenticatorData,
      signature: session.assertion.signature,
      directProof: session.assertion.directProof,
      envelopeNonce: rec.nonce,
      envelopeCiphertext: rec.ciphertext,
      binding: bindingResponse.binding,
      bindingDirectSig: bytesToHex(bindingDirectSig),
      bindingPhoneSig: bytesToHex(bindingPhoneSig),
    })
    const live = await fetchVaultStatus(undefined, vaultId)
    if (!live.passkeyLoginAvailable) {
      throw new Error('authorizer did not persist passkey sign-in recovery data')
    }
    return live
  } finally {
    zeroBytes(session?.prf, session?.scalar, phoneRoutineSecret)
  }
}

export async function signInWithPasskey(vaultId?: string): Promise<{ status: VaultStatus; enrollment: EnrollmentSecrets }> {
  let session: Awaited<ReturnType<typeof beginPasskeySession>> | undefined
  let phoneRoutineSecret: Uint8Array | undefined
  try {
    const id = arguments.length > 0 ? String(vaultId ?? '').trim() : undefined
    if (arguments.length > 0 && !id) throw new Error('vault id required')
    const status = id ? await fetchVaultStatus(undefined, id) : await fetchVaultStatus()
    if (!status.enrolled) throw new Error('this deployment has not been set up yet')
    if (!status.passkeyLoginAvailable) {
      throw new Error('passkey sign-in must first be enabled on the original enrolled device')
    }
    session = await beginPasskeySession('recover', status)
    const recovered = await vaultPost<{
      binding: string
      bindingDigest: string
      envelopeNonce: string
      envelopeCiphertext: string
      bindingDirectSig: string
      bindingPhoneSig: string
    }>('/v1/passkey/recover', { vaultId: status.vaultId, ...session.assertion })
    const parsed = parseRecoveryBinding(recovered.binding)
    if (bytesToHex(session.credentialId) !== parsed.credentialId) {
      throw new Error('selected passkey does not belong to this vault')
    }
    const kek = await deriveKEK(session.prf)
    phoneRoutineSecret = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: hexToBytes(recovered.envelopeNonce) },
        kek,
        hexToBytes(recovered.envelopeCiphertext),
      ),
    )
    const verified = verifyRecoveryBindingSignatures({
      binding: recovered.binding,
      bindingDigestHex: recovered.bindingDigest,
      bindingDirectSigHex: recovered.bindingDirectSig,
      bindingPhoneSigHex: recovered.bindingPhoneSig,
      derivedDirectPub: session.derivedDirectPub,
      phoneRoutineSecret,
    })
    assertRecoveryBindingMatchesStatus(verified, status)
    return { status: await fetchVaultStatus(undefined, status.vaultId), enrollment: recordFromRecoveryBinding(verified) }
  } finally {
    zeroBytes(session?.prf, session?.scalar, phoneRoutineSecret)
  }
}

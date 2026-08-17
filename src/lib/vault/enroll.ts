import { p256 } from '@noble/curves/nist.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { vaultPost } from './api'
import { bytesToHex, hexToBytes } from './hex'
import { xOnly } from './setup'
import {
  clearStagedEnrollment,
  loadStagedEnrollment,
  promoteStagedEnrollment,
  saveStagedEnrollment,
  type StagedEnrollment,
} from './enrollment'
import { pinEnrolledStatus } from './pin'
import { fetchPublicStatus, fetchVaultStatus } from './status'
import type { VaultStatus } from './types'
import { allowPasskey, passkeyCreateOptions, passkeyGetOptions, prfExtension, prfFrom } from './webauthn'

const PRF_SALT = new TextEncoder().encode('arkade-2fa-vault/prf/v1')
const HKDF_INFO = new TextEncoder().encode('arkade-2fa-vault/kek/v1')
const DIRECT_INFO = new TextEncoder().encode('arkade-2fa-vault/direct-p256/v1')

export interface EnrollmentSecrets {
  vaultId?: string
  credId: string
  webauthnP256: string
  phoneDirectP256: string
  phoneRoutineBip340Pub: string
  nonce: string
  ciphertext: string
}

const POP_DOMAIN = new TextEncoder().encode('arkade-2fa-vault/enrollment-pop/v1')

export function enrollmentPoPDigest(input: {
  vaultId: string
  credentialId: string
  webauthnP256: string
  phoneDirectP256: string
  phoneRoutineBip340Pub: string
  externalOwnerWalletXOnly: string
  recoveryKeyXOnly: string
}): Uint8Array {
  const out: number[] = [...POP_DOMAIN]
  for (const field of [
    new TextEncoder().encode(input.vaultId),
    hexToBytes(input.credentialId),
    hexToBytes(input.webauthnP256),
    hexToBytes(input.phoneDirectP256),
    hexToBytes(input.phoneRoutineBip340Pub),
    hexToBytes(input.externalOwnerWalletXOnly),
    hexToBytes(input.recoveryKeyXOnly),
  ]) {
    out.push(0)
    out.push(...field)
  }
  return sha256(new Uint8Array(out))
}

function requireRPID(status: { rpId?: string; clientOrigin?: string }): string {
  const rpId = String(status.rpId || '').toLowerCase()
  if (!rpId || rpId !== location.hostname.toLowerCase()) {
    throw new Error('deployment RP ID does not match this signing client host')
  }
  if (status.clientOrigin !== location.origin) {
    throw new Error('deployment origin does not match this signing client origin')
  }
  return rpId
}

async function compressedES256(response: AuthenticatorAttestationResponse): Promise<Uint8Array> {
  if (response.getPublicKeyAlgorithm() !== -7) throw new Error('credential public key must use ES256')
  const spki = response.getPublicKey()
  if (!spki) throw new Error('credential public key unavailable')
  const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error('credential public key must be uncompressed P-256')
  const out = new Uint8Array(33)
  out[0] = (raw[64] & 1) === 1 ? 0x03 : 0x02
  out.set(raw.subarray(1, 33), 1)
  return out
}

async function deriveDirectP256(prf: Uint8Array): Promise<{ pub: Uint8Array }> {
  const key = await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveBits'])
  for (let counter = 0; counter <= 255; counter++) {
    const info = new Uint8Array(DIRECT_INFO.length + 4)
    info.set(DIRECT_INFO)
    new DataView(info.buffer).setUint32(info.length - 4, counter, false)
    const scalar = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info }, key, 256),
    )
    if (p256.utils.isValidSecretKey(scalar)) {
      return { pub: p256.getPublicKey(scalar, true) }
    }
    scalar.fill(0)
  }
  throw new Error('authenticator did not return PRF')
}

export function requireTenantEnrollmentProofs(roles: { ownerSecret?: string; recoverySecret?: string }) {
  if (!roles.ownerSecret || !roles.recoverySecret) {
    throw new Error('tenant enrollment requires owner and recovery signatures')
  }
}

export async function enrollWithPasskey(
  enrollmentToken: string,
  roles: { hardwarePub: string; recoveryPub: string; ownerSecret?: string; recoverySecret?: string },
): Promise<{ status: VaultStatus; enrollment: EnrollmentSecrets }> {
  if (typeof location !== 'undefined' && location.hostname === '127.0.0.1') {
    throw new Error('Open this page as http://localhost:3003 so the passkey can bind to localhost.')
  }
  const token = String(enrollmentToken || '').trim()
  if (!token) throw new Error('setup code required')
  requireTenantEnrollmentProofs(roles)
  const publicStatus = await fetchPublicStatus()
  const hardwareXOnly = xOnly(roles.hardwarePub)
  const recoveryXOnly = xOnly(roles.recoveryPub)
  if (hardwareXOnly === recoveryXOnly) {
    throw new Error('Hardware and recovery must be different keys')
  }
  const rpId = requireRPID(publicStatus)
  const start = await vaultPost<{
    handle: string
    vaultId: string
    challenge: string
    rpId: string
    userId: string
    userName: string
  }>('/v1/enroll/start', {}, { 'X-Vault-Enrollment-Token': token })
  if (!start.vaultId || !start.challenge || !start.handle || !start.userId) {
    throw new Error('authorizer did not assign a vault')
  }
  const cred = (await navigator.credentials.create({
    publicKey: passkeyCreateOptions({
      rp: { name: 'Spending vault', id: start.rpId || rpId },
      user: {
        id: hexToBytes(start.userId) as BufferSource,
        name: start.userName || 'vault',
        displayName: 'Spending vault',
      },
      challenge: hexToBytes(start.challenge) as BufferSource,
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: prfExtension(PRF_SALT),
    }),
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('The operation was aborted.')
  let prf = prfFrom(cred)
  if (!prf) {
    const get = (await navigator.credentials.get({
      publicKey: passkeyGetOptions(
        {
          challenge: hexToBytes(start.challenge) as BufferSource,
          rpId: start.rpId || rpId,
          allowCredentials: [allowPasskey(cred.rawId, true)],
          userVerification: 'required',
          extensions: prfExtension(PRF_SALT, new Uint8Array(cred.rawId)),
        },
        true,
      ),
    })) as PublicKeyCredential | null
    prf = get ? prfFrom(get) : null
  }
  if (!prf || prf.length !== 32) throw new Error('authenticator did not return PRF')

  const att = cred.response as AuthenticatorAttestationResponse
  const webauthnP256 = await compressedES256(att)
  const direct = await deriveDirectP256(prf)
  const phoneRoutineSecret = crypto.getRandomValues(new Uint8Array(32))
  const phoneRoutineBip340Pub = secp256k1.getPublicKey(phoneRoutineSecret, true)
  const kek = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO },
    await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, kek, phoneRoutineSecret),
  )
  const enrollment: EnrollmentSecrets = {
    vaultId: start.vaultId,
    credId: bytesToHex(new Uint8Array(cred.rawId)),
    webauthnP256: bytesToHex(webauthnP256),
    phoneDirectP256: bytesToHex(direct.pub),
    phoneRoutineBip340Pub: bytesToHex(phoneRoutineBip340Pub),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  }
  const pop = enrollmentPoPDigest({
    vaultId: start.vaultId,
    credentialId: enrollment.credId,
    webauthnP256: enrollment.webauthnP256,
    phoneDirectP256: enrollment.phoneDirectP256,
    phoneRoutineBip340Pub: enrollment.phoneRoutineBip340Pub,
    externalOwnerWalletXOnly: hardwareXOnly,
    recoveryKeyXOnly: recoveryXOnly,
  })
  const ownerProof = bytesToHex(schnorr.sign(pop, hexToBytes(roles.ownerSecret)))
  const recoveryProof = bytesToHex(schnorr.sign(pop, hexToBytes(roles.recoverySecret)))
  prf.fill(0)
  phoneRoutineSecret.fill(0)
  const authData = att.getAuthenticatorData ? new Uint8Array(att.getAuthenticatorData()) : new Uint8Array()
  const staged: StagedEnrollment = {
    ...enrollment,
    handle: start.handle,
    userHandle: start.userId,
    clientDataJSON: bytesToHex(new Uint8Array(att.clientDataJSON)),
    authenticatorData: bytesToHex(authData),
    attestationObject: bytesToHex(new Uint8Array(att.attestationObject)),
    hardwareXOnly,
    recoveryXOnly,
    ownerProof,
    recoveryProof,
  }
  saveStagedEnrollment(staged)
  await vaultPost(
    '/v1/enroll/finish',
    {
      handle: staged.handle,
      userHandle: staged.userHandle,
      clientDataJSON: staged.clientDataJSON,
      authenticatorData: staged.authenticatorData,
      attestationObject: staged.attestationObject,
      credentialId: enrollment.credId,
      webauthnP256: enrollment.webauthnP256,
      phoneDirectP256: enrollment.phoneDirectP256,
      phoneRoutineBip340Pub: enrollment.phoneRoutineBip340Pub,
      vaultId: start.vaultId,
      externalOwnerWalletXOnly: hardwareXOnly,
      recoveryKeyXOnly: recoveryXOnly,
      externalOwnerProof: ownerProof,
      recoveryProof: recoveryProof,
    },
    { 'X-Vault-Enrollment-Token': token },
  )
  const live = await fetchVaultStatus(undefined, start.vaultId)
  pinEnrolledStatus(live)
  promoteStagedEnrollment(enrollment)
  return { status: live, enrollment }
}

export async function reconcileStagedEnrollment(
  storage: Storage = localStorage,
): Promise<{ status: VaultStatus; enrollment: EnrollmentSecrets } | null> {
  const staged = loadStagedEnrollment(storage)
  if (!staged?.vaultId) return null
  const live = await fetchVaultStatus(undefined, staged.vaultId)
  if (!live.enrolled) return null
  pinEnrolledStatus(live, storage)
  promoteStagedEnrollment(staged, storage)
  return { status: live, enrollment: staged }
}

export function abandonStagedEnrollment(storage: Storage = localStorage) {
  clearStagedEnrollment(storage)
}

export function hexCredentialId(id: string): BufferSource {
  return hexToBytes(id) as BufferSource
}

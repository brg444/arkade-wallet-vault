import { p256 } from '@noble/curves/nist.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { vaultPost } from './api'
import { bytesToHex, hexToBytes } from './hex'
import { xOnly } from './setupPlan'
import {
  clearStagedEnrollment,
  loadStagedEnrollment,
  promoteStagedEnrollment,
  saveStagedEnrollment,
  type StagedEnrollment,
} from './enrollmentStore'
import { requireV5ProposedDescriptor } from './v5/enroll'
import { saveLocalKit } from './v5/kitStore'
import { buildRecoveryKit } from './v5/kit'
import { pinEnrolledStatus, pinFromEnrolledStatus, requireStatusMatchesPin, saveAddressPin } from './pin'
import { fetchPublicStatus, fetchVaultStatus } from './status'
import type { VaultStatus } from './types'
import type { V5PublicDescriptor } from './v5/descriptor'
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

export interface EnrollmentRoles {
  hardwarePub: string
  recoveryPub?: string
}

export async function enrollWithPasskey(
  enrollmentToken: string,
  roles: EnrollmentRoles,
): Promise<{ status: VaultStatus; enrollment: EnrollmentSecrets }> {
  await beginTenantEnrollment(enrollmentToken, roles)
  return finishTenantEnrollment(enrollmentToken)
}

export async function beginTenantEnrollment(
  enrollmentToken: string,
  roles: EnrollmentRoles,
): Promise<{ enrollment: EnrollmentSecrets; descriptor?: V5PublicDescriptor }> {
  if (typeof location !== 'undefined' && location.hostname === '127.0.0.1') {
    throw new Error('Open this page as http://localhost:3003 so the passkey can bind to localhost.')
  }
  const token = String(enrollmentToken || '').trim()
  if (!token) throw new Error('setup code required')
  const wantRecovery = Boolean(roles.recoveryPub)
  const publicStatus = await fetchPublicStatus()
  const hardwareXOnly = xOnly(roles.hardwarePub)
  const recoveryXOnly = wantRecovery ? xOnly(roles.recoveryPub || '') : ''
  if (wantRecovery && hardwareXOnly === recoveryXOnly) throw new Error('Recovery must be a different key')
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
  prf.fill(0)
  phoneRoutineSecret.fill(0)
  const authData = att.getAuthenticatorData ? new Uint8Array(att.getAuthenticatorData()) : new Uint8Array()
  const proposed = await vaultPost<{
    vaultId: string
    descriptorHash: string
    descriptor: unknown
  }>(
    '/v1/enroll/propose',
    {
      handle: start.handle,
      userHandle: start.userId,
      clientDataJSON: bytesToHex(new Uint8Array(att.clientDataJSON)),
      authenticatorData: bytesToHex(authData),
      attestationObject: bytesToHex(new Uint8Array(att.attestationObject)),
      credentialId: enrollment.credId,
      webauthnP256: enrollment.webauthnP256,
      phoneDirectP256: enrollment.phoneDirectP256,
      phoneRoutineBip340Pub: enrollment.phoneRoutineBip340Pub,
      vaultId: start.vaultId,
      externalOwnerWalletXOnly: hardwareXOnly,
      ...(recoveryXOnly ? { recoveryXOnly } : {}),
    },
    { 'X-Vault-Enrollment-Token': token },
  )
  if (wantRecovery) {
    const descriptor = requireV5ProposedDescriptor(proposed.descriptor, proposed.descriptorHash)
    if (xOnly(descriptor.keys.recovery || '') !== recoveryXOnly) {
      throw new Error('proposed recovery key does not match this client')
    }
    if (xOnly(descriptor.keys.hardware) !== hardwareXOnly) {
      throw new Error('proposed hardware key does not match this client')
    }
    const staged: StagedEnrollment = {
      ...enrollment,
      handle: start.handle,
      userHandle: start.userId,
      clientDataJSON: bytesToHex(new Uint8Array(att.clientDataJSON)),
      authenticatorData: bytesToHex(authData),
      attestationObject: bytesToHex(new Uint8Array(att.attestationObject)),
      hardwareXOnly,
      recoveryXOnly,
      inviteToken: token,
      descriptorHash: proposed.descriptorHash,
      operationalAddress: descriptor.daily.address,
      operationalScript: descriptor.daily.script,
      savingsAddress: descriptor.savings.address,
    }
    saveStagedEnrollment(staged)
    saveLocalKit(buildRecoveryKit(descriptor))
    return { enrollment, descriptor }
  }
  const descriptor = requireV5ProposedDescriptor(proposed.descriptor, proposed.descriptorHash)
  if (descriptor.keys.recovery) throw new Error('this setup skipped recovery')
  if (xOnly(descriptor.keys.hardware) !== hardwareXOnly) {
    throw new Error('proposed hardware key does not match this client')
  }
  const staged: StagedEnrollment = {
    ...enrollment,
    handle: start.handle,
    userHandle: start.userId,
    clientDataJSON: bytesToHex(new Uint8Array(att.clientDataJSON)),
    authenticatorData: bytesToHex(authData),
    attestationObject: bytesToHex(new Uint8Array(att.attestationObject)),
    hardwareXOnly,
    inviteToken: token,
    descriptorHash: proposed.descriptorHash,
    operationalAddress: descriptor.daily.address,
    operationalScript: descriptor.daily.script,
    savingsAddress: descriptor.savings.address,
  }
  saveStagedEnrollment(staged)
  saveLocalKit(buildRecoveryKit(descriptor))
  return { enrollment, descriptor }
}

export async function finishTenantEnrollment(
  enrollmentToken: string,
  storage: Storage = localStorage,
): Promise<{ status: VaultStatus; enrollment: EnrollmentSecrets }> {
  const token = String(enrollmentToken || '').trim()
  if (!token) throw new Error('setup code required')
  const staged = loadStagedEnrollment(storage)
  if (!staged?.vaultId || !staged.descriptorHash) throw new Error('finish setup first')
  await vaultPost(
    '/v1/enroll/finish',
    {
      handle: staged.handle,
      userHandle: staged.userHandle,
      clientDataJSON: staged.clientDataJSON,
      authenticatorData: staged.authenticatorData,
      attestationObject: staged.attestationObject,
      credentialId: staged.credId,
      webauthnP256: staged.webauthnP256,
      phoneDirectP256: staged.phoneDirectP256,
      phoneRoutineBip340Pub: staged.phoneRoutineBip340Pub,
      vaultId: staged.vaultId,
      externalOwnerWalletXOnly: staged.hardwareXOnly,
      ...(staged.recoveryXOnly ? { recoveryXOnly: staged.recoveryXOnly } : {}),
      descriptorHash: staged.descriptorHash,
    },
    { 'X-Vault-Enrollment-Token': token },
  )
  const live = await fetchVaultStatus(undefined, staged.vaultId)
  const pin = pinFromEnrolledStatus({
    ...live,
    operationalAddress: staged.operationalAddress || live.operationalAddress,
    operationalScript: staged.operationalScript || live.operationalScript,
    savingsAddress: staged.savingsAddress || live.savingsAddress,
  })
  saveAddressPin(pin, storage)
  requireStatusMatchesPin(live, pin)
  pinEnrolledStatus(live, storage)
  promoteStagedEnrollment(staged, storage)
  return { status: live, enrollment: staged }
}

export async function reconcileStagedEnrollment(
  storage: Storage = localStorage,
): Promise<{ status: VaultStatus; enrollment: EnrollmentSecrets } | null> {
  const staged = loadStagedEnrollment(storage)
  if (!staged?.vaultId) return null
  const live = await fetchVaultStatus(undefined, staged.vaultId)
  if (!live.enrolled) return null
  if (staged.operationalAddress && staged.operationalScript && staged.savingsAddress) {
    const pin = pinFromEnrolledStatus({
      ...live,
      operationalAddress: staged.operationalAddress,
      operationalScript: staged.operationalScript,
      savingsAddress: staged.savingsAddress,
    })
    saveAddressPin(pin, storage)
    requireStatusMatchesPin(live, pin)
  } else {
    pinEnrolledStatus(live, storage)
  }
  promoteStagedEnrollment(staged, storage)
  return { status: live, enrollment: staged }
}

export function abandonStagedEnrollment(storage: Storage = localStorage) {
  clearStagedEnrollment(storage)
}

export function hexCredentialId(id: string): BufferSource {
  return hexToBytes(id) as BufferSource
}

import { p256 } from '@noble/curves/nist.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { vaultGet, vaultPost } from './api'
import { bytesToHex, hexToBytes } from './hex'
import { requireStatusIdentity } from './status'
import type { VaultStatus } from './types'

const PRF_SALT = new TextEncoder().encode('arkade-2fa-vault/prf/v1')
const HKDF_INFO = new TextEncoder().encode('arkade-2fa-vault/kek/v1')
const DIRECT_INFO = new TextEncoder().encode('arkade-2fa-vault/direct-p256/v1')

export interface EnrollmentSecrets {
  credId: string
  webauthnP256: string
  phoneDirectP256: string
  phoneRoutineBip340Pub: string
  nonce: string
  ciphertext: string
}

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

function prfFrom(cred: PublicKeyCredential): Uint8Array | null {
  const ext = cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
  const first = ext?.prf?.results?.first
  return first ? new Uint8Array(first) : null
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

export async function enrollWithPasskey(): Promise<{ status: VaultStatus; enrollment: EnrollmentSecrets }> {
  if (typeof location !== 'undefined' && location.hostname === '127.0.0.1') {
    throw new Error('Open this page as http://localhost:3003 so the passkey can bind to localhost.')
  }
  const status = requireStatusIdentity(await vaultGet<VaultStatus>('/v1/status'))
  const rpId = requireRPID(status)
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Spending vault', id: rpId },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'vault', displayName: 'Spending vault' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('The operation was aborted.')
  let prf = prfFrom(cred)
  if (!prf) {
    const get = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId,
        allowCredentials: [{ type: 'public-key', id: cred.rawId }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: PRF_SALT } } },
      },
    })) as PublicKeyCredential | null
    prf = get ? prfFrom(get) : null
  }
  if (!prf || prf.length !== 32) throw new Error('authenticator did not return PRF')

  const webauthnP256 = await compressedES256(cred.response as AuthenticatorAttestationResponse)
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
    credId: bytesToHex(new Uint8Array(cred.rawId)),
    webauthnP256: bytesToHex(webauthnP256),
    phoneDirectP256: bytesToHex(direct.pub),
    phoneRoutineBip340Pub: bytesToHex(phoneRoutineBip340Pub),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(ciphertext),
  }
  prf.fill(0)
  phoneRoutineSecret.fill(0)
  await vaultPost('/v1/register', {
    credentialId: enrollment.credId,
    webauthnP256: enrollment.webauthnP256,
    phoneDirectP256: enrollment.phoneDirectP256,
    phoneRoutineBip340Pub: enrollment.phoneRoutineBip340Pub,
  })
  const live = requireStatusIdentity(await vaultGet<VaultStatus>('/v1/status'))
  return { status: live, enrollment }
}

export function hexCredentialId(id: string): BufferSource {
  return hexToBytes(id) as BufferSource
}

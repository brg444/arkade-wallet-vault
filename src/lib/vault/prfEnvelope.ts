import { bytesToHex, hexToBytes, requireLowerHex } from './hex'
import { zeroBytes } from './ceremony/directauth'

export const PRF_SALT_UTF8 = 'arkade-2fa-vault/prf/v1'
export const KEK_HKDF_INFO_UTF8 = 'arkade-2fa-vault/kek/v1'
export const PRF_SALT = new TextEncoder().encode(PRF_SALT_UTF8)
export const KEK_HKDF_INFO = new TextEncoder().encode(KEK_HKDF_INFO_UTF8)

const ENVELOPE_NONCE_BYTES = 12
const PHONE_SECRET_BYTES = 32
const ENVELOPE_CIPHERTEXT_BYTES = 48

async function deriveKEK(prf: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (prf.length !== 32) throw new Error('prf must be exactly 32 bytes')
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: KEK_HKDF_INFO as BufferSource },
    await crypto.subtle.importKey('raw', prf as BufferSource, 'HKDF', false, ['deriveKey']),
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

export async function wrapPhoneSecret(
  prf: Uint8Array,
  phoneSecret: Uint8Array,
): Promise<{ nonce: string; ciphertext: string }> {
  if (phoneSecret.length !== PHONE_SECRET_BYTES) throw new Error('phone key must be 32 bytes')
  const nonce = crypto.getRandomValues(new Uint8Array(ENVELOPE_NONCE_BYTES))
  const kek = await deriveKEK(prf, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, kek, phoneSecret as BufferSource),
  )
  if (ciphertext.length !== ENVELOPE_CIPHERTEXT_BYTES) throw new Error('saved passkey envelope is malformed')
  return { nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) }
}

export async function unwrapPhoneSecret(prf: Uint8Array, nonceHex: string, ciphertextHex: string): Promise<Uint8Array> {
  const nonce = hexToBytes(requireLowerHex(nonceHex, 'envelope nonce', ENVELOPE_NONCE_BYTES))
  const ciphertext = hexToBytes(requireLowerHex(ciphertextHex, 'envelope ciphertext', ENVELOPE_CIPHERTEXT_BYTES))
  try {
    const kek = await deriveKEK(prf, ['decrypt'])
    const secret = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, kek, ciphertext))
    if (secret.length !== PHONE_SECRET_BYTES) {
      zeroBytes(secret)
      throw new Error('saved passkey envelope did not contain a phone key')
    }
    return secret
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('saved passkey envelope')) throw error
    throw new Error('passkey PRF authentication succeeded but could not decrypt the saved phone key', {
      cause: error,
    })
  }
}

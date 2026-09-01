import { p256 } from '@noble/curves/nist.js'

export const DIRECT_P256_HKDF_PREFIX = new TextEncoder().encode('arkade-2fa-vault/direct-p256/v1')

export function hkdfInfo(counter: number): Uint8Array {
  if (!Number.isInteger(counter) || counter < 0 || counter > 255) {
    throw new Error('HKDF counter must be an integer in 0..255')
  }
  const info = new Uint8Array(DIRECT_P256_HKDF_PREFIX.length + 4)
  info.set(DIRECT_P256_HKDF_PREFIX)
  new DataView(info.buffer).setUint32(info.length - 4, counter, false)
  return info
}

export async function deriveDirectP256(prf: Uint8Array): Promise<{
  scalar: Uint8Array
  pub: Uint8Array
  counter: number
}> {
  const ikm = requireBytes(prf, 'prf')
  if (ikm.length !== 32) throw new Error('prf must be exactly 32 bytes')
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  for (let counter = 0; counter <= 255; counter++) {
    const scalar = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: hkdfInfo(counter) as BufferSource },
        key,
        256,
      ),
    )
    if (p256.utils.isValidSecretKey(scalar)) {
      return { scalar, pub: p256.getPublicKey(scalar, true), counter }
    }
    zeroBytes(scalar)
  }
  throw new Error('direct-auth P-256 scalar out of range')
}

export function signDirectP256(scalar: Uint8Array, digest: Uint8Array): Uint8Array {
  const secret = requireBytes(scalar, 'direct-auth scalar')
  if (!p256.utils.isValidSecretKey(secret)) throw new Error('invalid direct-auth scalar')
  const message = requireBytes(digest, 'digest')
  if (message.length !== 32) throw new Error('Arkade digest must be 32 bytes')
  const signature = p256.sign(message, secret, { prehash: false, lowS: true, format: 'compact' })
  if (signature.length !== 64) throw new Error('direct signature must be 64 compact bytes')
  return signature
}

export function verifyDirectP256(pub: Uint8Array, digest: Uint8Array, signature: Uint8Array): boolean {
  const key = requireBytes(pub, 'direct-auth pub')
  const message = requireBytes(digest, 'digest')
  const compact = requireBytes(signature, 'signature')
  if (key.length !== 33) throw new Error('direct-auth pub must be 33 bytes')
  if (message.length !== 32) throw new Error('Arkade digest must be 32 bytes')
  if (compact.length !== 64) throw new Error('direct signature must be 64 compact bytes')
  return p256.verify(compact, message, key, { prehash: false, lowS: true, format: 'compact' })
}

export function zeroBytes(...values: Array<Uint8Array | null | undefined>): void {
  for (const value of values) value?.fill(0)
}

function requireBytes(value: Uint8Array | ArrayBuffer, name: string): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new Error(`${name} required`)
}

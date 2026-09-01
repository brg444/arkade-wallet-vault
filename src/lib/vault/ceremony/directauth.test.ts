import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import { deriveDirectP256, hkdfInfo, signDirectP256, verifyDirectP256, zeroBytes } from './directauth'

describe('direct P-256 authorization', () => {
  it('derives deterministically and verifies compact signatures', async () => {
    const prf = new Uint8Array(32).fill(0x42)
    const first = await deriveDirectP256(prf)
    const second = await deriveDirectP256(prf)
    expect(first.pub).toEqual(second.pub)
    expect(first.counter).toBe(second.counter)
    const digest = sha256(new TextEncoder().encode('arkade-vault/direct-auth-test'))
    const signature = signDirectP256(first.scalar, digest)
    expect(signature).toHaveLength(64)
    expect(verifyDirectP256(first.pub, digest, signature)).toBe(true)
    zeroBytes(first.scalar, second.scalar)
    expect(first.scalar.every((byte) => byte === 0)).toBe(true)
  })

  it('encodes the HKDF counter as big-endian uint32', () => {
    expect(Array.from(hkdfInfo(1).slice(-4))).toEqual([0, 0, 0, 1])
    expect(() => hkdfInfo(256)).toThrow(/0\.\.255/)
  })

  it('clears every available secret without masking an earlier partial-session failure', () => {
    const secret = new Uint8Array([1, 2, 3])
    expect(() => zeroBytes(undefined, secret, null)).not.toThrow()
    expect(secret).toEqual(new Uint8Array(3))
  })
})

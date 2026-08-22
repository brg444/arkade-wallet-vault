import { schnorr } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { signVtxoReserveDigest, verifyVtxoReserveSignature, vtxoReserveDigest } from './reserveAuth'

const VECTOR = {
  operationId: '000102030405060708090a0b0c0d0e0f',
  vaultId: 'vault-vector-1',
  destScript: `5120${'11'.repeat(32)}`,
  amountSats: 123_456_789,
  phoneSecret: '03'.padStart(64, '0'),
  phonePub: 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
  digest: '48de90168b40f88d8e705228c56f9ed83b969d319b0b8dbc3aedfe45da0c1981',
  signature:
    '6196fc6c472bc605daa653b8a8096a171d80abdccb7faf12859776ba631cdbc20fd5e0d0509eaee085e916b1a1c83beada2290fbefcdbf746a452b5416e0a64a',
} as const

function input(overrides: Partial<Parameters<typeof vtxoReserveDigest>[0]> = {}) {
  return {
    operationId: VECTOR.operationId,
    vaultId: VECTOR.vaultId,
    destScript: hex.decode(VECTOR.destScript),
    amountSats: VECTOR.amountSats,
    ...overrides,
  }
}

describe('VTXO reserve authentication', () => {
  it('matches the cross-language tagged-hash and deterministic Schnorr vector', () => {
    const digest = vtxoReserveDigest(input())
    const signature = signVtxoReserveDigest(input(), hex.decode(VECTOR.phoneSecret), new Uint8Array(32))
    expect(hex.encode(digest)).toBe(VECTOR.digest)
    expect(hex.encode(schnorr.getPublicKey(hex.decode(VECTOR.phoneSecret)))).toBe(VECTOR.phonePub)
    expect(hex.encode(signature)).toBe(VECTOR.signature)
    expect(verifyVtxoReserveSignature(input(), VECTOR.signature, hex.decode(VECTOR.phonePub))).toBe(true)
  })

  it('binds the signature to every caller-controlled economic field', () => {
    const pub = hex.decode(VECTOR.phonePub)
    expect(verifyVtxoReserveSignature(input({ operationId: '10'.repeat(16) }), VECTOR.signature, pub)).toBe(false)
    expect(verifyVtxoReserveSignature(input({ vaultId: 'vault-vector-2' }), VECTOR.signature, pub)).toBe(false)
    expect(
      verifyVtxoReserveSignature(input({ destScript: hex.decode(`5120${'22'.repeat(32)}`) }), VECTOR.signature, pub),
    ).toBe(false)
    expect(verifyVtxoReserveSignature(input({ amountSats: VECTOR.amountSats + 1 }), VECTOR.signature, pub)).toBe(false)
    expect(verifyVtxoReserveSignature(input(), `0${VECTOR.signature.slice(1)}`, pub)).toBe(false)
  })

  it('rejects non-canonical ids, scripts, amounts, and signatures', () => {
    expect(() => vtxoReserveDigest(input({ operationId: VECTOR.operationId.toUpperCase() }))).toThrow(/operation id/)
    expect(() => vtxoReserveDigest(input({ destScript: new Uint8Array() }))).toThrow(/destination script/)
    expect(() => vtxoReserveDigest(input({ amountSats: Number.MAX_SAFE_INTEGER + 1 }))).toThrow(/safe uint64/)
    expect(verifyVtxoReserveSignature(input(), VECTOR.signature.toUpperCase(), hex.decode(VECTOR.phonePub))).toBe(false)
  })
})

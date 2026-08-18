import { describe, expect, it } from 'vitest'
import { enrollmentPoPDigest } from './tenantEnrollment'
import { vaultStatusPath } from './status'

describe('tenant enrollment identity', () => {
  it('rejects an explicit empty vault id on the status path', () => {
    expect(() => vaultStatusPath('')).toThrow(/vault id required/)
  })

  it('binds the enrollment proof to the full client tuple', () => {
    const digest = enrollmentPoPDigest({
      vaultId: 'tenant-b',
      credentialId: 'aa',
      webauthnP256: '02' + '11'.repeat(32),
      phoneDirectP256: '03' + '22'.repeat(32),
      phoneRoutineBip340Pub: '02' + '33'.repeat(32),
      externalOwnerWalletXOnly: '44'.repeat(32),
      descriptorHash: '66'.repeat(32),
    })
    expect(digest.length).toBe(32)
    const other = enrollmentPoPDigest({
      vaultId: 'tenant-b',
      credentialId: 'ab',
      webauthnP256: '02' + '11'.repeat(32),
      phoneDirectP256: '03' + '22'.repeat(32),
      phoneRoutineBip340Pub: '02' + '33'.repeat(32),
      externalOwnerWalletXOnly: '44'.repeat(32),
      descriptorHash: '66'.repeat(32),
    })
    expect(Buffer.from(digest).equals(Buffer.from(other))).toBe(false)
    const swappedTree = enrollmentPoPDigest({
      vaultId: 'tenant-b',
      credentialId: 'aa',
      webauthnP256: '02' + '11'.repeat(32),
      phoneDirectP256: '03' + '22'.repeat(32),
      phoneRoutineBip340Pub: '02' + '33'.repeat(32),
      externalOwnerWalletXOnly: '44'.repeat(32),
      descriptorHash: '77'.repeat(32),
    })
    expect(Buffer.from(digest).equals(Buffer.from(swappedTree))).toBe(false)
  })
})

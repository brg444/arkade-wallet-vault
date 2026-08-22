import { describe, expect, it } from 'vitest'
import { buildVaultProgramDescriptor, hashVaultProgramDescriptor } from './descriptor'
import { requireProposedProgramDescriptor } from './enroll'
import { PROGRAM_FIXTURE } from './fixtures'

describe('staged enrollment descriptor', () => {
  it('accepts the exact proposed descriptor and rejects leftovers or a wrong hash', () => {
    expect(() => requireProposedProgramDescriptor({ schema: 'retired' }, 'aa'.repeat(32))).toThrow(
      /current Vault Program descriptor/,
    )
    const skipped = buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, recoveryPub: undefined })
    expect(skipped.keys.recovery).toBeUndefined()
    expect(requireProposedProgramDescriptor(skipped, hashVaultProgramDescriptor(skipped)).vaultId).toBe(skipped.vaultId)
    const descriptor = buildVaultProgramDescriptor(PROGRAM_FIXTURE)
    const hash = hashVaultProgramDescriptor(descriptor)
    expect(() => requireProposedProgramDescriptor(descriptor, '00'.repeat(32))).toThrow(/hash/)
    expect(requireProposedProgramDescriptor(descriptor, hash).vaultId).toBe(descriptor.vaultId)
  })
})

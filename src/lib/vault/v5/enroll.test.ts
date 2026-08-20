import { describe, expect, it } from 'vitest'
import { sampleDescriptor } from '../sample'
import { buildV5Descriptor, hashV5Descriptor } from './descriptor'
import { requireV5ProposedDescriptor } from './enroll'
import { V5_FIXTURE } from './fixtures'

describe('staged enrollment descriptor', () => {
  it('accepts the exact proposed descriptor and rejects leftovers or a wrong hash', () => {
    const leftover = sampleDescriptor()
    expect(() => requireV5ProposedDescriptor(leftover, 'aa'.repeat(32))).toThrow(/v5 vault/)
    const skipped = buildV5Descriptor({ ...V5_FIXTURE, recoveryPub: undefined })
    expect(skipped.keys.recovery).toBeUndefined()
    expect(requireV5ProposedDescriptor(skipped, hashV5Descriptor(skipped)).vaultId).toBe(skipped.vaultId)
    const descriptor = buildV5Descriptor(V5_FIXTURE)
    const hash = hashV5Descriptor(descriptor)
    expect(() => requireV5ProposedDescriptor(descriptor, '00'.repeat(32))).toThrow(/hash/)
    expect(requireV5ProposedDescriptor(descriptor, hash).vaultId).toBe(descriptor.vaultId)
  })
})

import { describe, expect, it } from 'vitest'
import { vaultStatusPath } from './status'
import { requireV5ProposedDescriptor } from './v5/enroll'
import { sampleDescriptor } from './sample'

describe('tenant enrollment identity', () => {
  it('rejects an explicit empty vault id on the status path', () => {
    expect(() => vaultStatusPath('')).toThrow(/vault id required/)
  })

  it('rejects a leftover v4 propose', () => {
    expect(() => requireV5ProposedDescriptor(sampleDescriptor(), '00'.repeat(32))).toThrow(/v5 vault/)
  })
})

import { describe, expect, it } from 'vitest'
import { vaultStatusPath } from './status'
import { requireProposedProgramDescriptor } from './program/enroll'

describe('tenant enrollment identity', () => {
  it('requires an explicit vault id on the status path', () => {
    expect(() => vaultStatusPath('')).toThrow(/vault id required/)
  })

  it('rejects a descriptor outside the current program', () => {
    expect(() => requireProposedProgramDescriptor({ schema: 'retired' }, '00'.repeat(32))).toThrow(
      /current Vault Program descriptor/,
    )
  })
})

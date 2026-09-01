import { describe, expect, it } from 'vitest'
import { requireProtectionTierMatchesRecovery } from './protectionTier'

describe('protection tier contract', () => {
  it('requires Standard without a recovery key and Advanced with one', () => {
    expect(requireProtectionTierMatchesRecovery('standard', '')).toBe('standard')
    expect(requireProtectionTierMatchesRecovery('advanced', '02' + '11'.repeat(32))).toBe('advanced')
    expect(() => requireProtectionTierMatchesRecovery('standard', '02' + '11'.repeat(32))).toThrow(/Standard/)
    expect(() => requireProtectionTierMatchesRecovery('advanced', '')).toThrow(/Advanced/)
    expect(() => requireProtectionTierMatchesRecovery('legacy', '')).toThrow(/unsupported/)
  })
})

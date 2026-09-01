import { describe, expect, it } from 'vitest'
import {
  CURRENT_SPENDING_POLICY_CAPABILITIES,
  canonicalSpendingPolicy,
  defaultSpendingPolicy,
  requireCurrentSpendingPolicyCapabilities,
  spendingPolicyDigest,
  validateSpendingPolicy,
} from './spendingPolicy'

describe('spending policy contract', () => {
  it('matches the server canonical bytes and digest', () => {
    const policy = defaultSpendingPolicy()
    expect(canonicalSpendingPolicy(policy)).toBe(
      '{"program":"vault-policy-v1","schema":"vault-spending-policy-v1","period":"rolling-24h","periodAllowanceSats":100000,"txRecipientCapSats":50000,"absoluteFeeCapSats":5000,"feerateCapSatPerV":10}',
    )
    expect(spendingPolicyDigest(policy)).toBe('d14d82444da7d49db0eb43d2307aaab0409da2481b5a845a8be5a44b70f9f912')
  })

  it('rejects policy substitutions and invalid relationships', () => {
    expect(() => validateSpendingPolicy({ ...defaultSpendingPolicy(), program: 'other' })).toThrow()
    expect(() =>
      validateSpendingPolicy({ ...defaultSpendingPolicy(), txRecipientCapSats: 75_000, periodAllowanceSats: 50_000 }),
    ).toThrow(/period allowance/)
    expect(() => validateSpendingPolicy({ ...defaultSpendingPolicy(), absoluteFeeCapSats: 4_999 })).toThrow(
      /absolute fee/,
    )
    expect(() => validateSpendingPolicy({ ...defaultSpendingPolicy(), feerateCapSatPerV: 11 })).toThrow(/feerate/)
    expect(() => validateSpendingPolicy({ ...defaultSpendingPolicy(), unexpected: true })).toThrow(/fields/)
    expect(
      canonicalSpendingPolicy({
        feerateCapSatPerV: 10,
        absoluteFeeCapSats: 5_000,
        txRecipientCapSats: 50_000,
        periodAllowanceSats: 100_000,
        period: 'rolling-24h',
        schema: 'vault-spending-policy-v1',
        program: 'vault-policy-v1',
      }),
    ).toBe(canonicalSpendingPolicy(defaultSpendingPolicy()))
  })

  it('validates the release capability advertisement', () => {
    expect(requireCurrentSpendingPolicyCapabilities(CURRENT_SPENDING_POLICY_CAPABILITIES)).toEqual(
      CURRENT_SPENDING_POLICY_CAPABILITIES,
    )
    expect(() =>
      requireCurrentSpendingPolicyCapabilities({
        ...CURRENT_SPENDING_POLICY_CAPABILITIES,
        bounds: { ...CURRENT_SPENDING_POLICY_CAPABILITIES.bounds, feerateCapSatPerV: { min: 1, max: 101 } },
      }),
    ).toThrow(/capabilities/)
    expect(() =>
      requireCurrentSpendingPolicyCapabilities({
        ...CURRENT_SPENDING_POLICY_CAPABILITIES,
        presets: [
          ...CURRENT_SPENDING_POLICY_CAPABILITIES.presets,
          { id: 'legacy', label: 'Legacy', policy: defaultSpendingPolicy() },
        ],
      }),
    ).toThrow(/presets/)
  })
})

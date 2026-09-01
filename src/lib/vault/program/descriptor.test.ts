import { describe, expect, it } from 'vitest'
import { FORBIDDEN_PUBLIC_KEY_2G } from '../setupPlan'
import { defaultSpendingPolicy } from '../spendingPolicy'
import { FAMILY_KEYS, PROGRAM_CSV, PROGRAM_SCHEMA, SAVINGS_TEMPLATE } from './constants'
import { buildVaultProgramDescriptor, hashVaultProgramDescriptor, validateVaultProgramDescriptor } from './descriptor'
import { PROGRAM_FIXTURE } from './fixtures'

function fixtureDescriptor() {
  return buildVaultProgramDescriptor(PROGRAM_FIXTURE)
}

describe('Savings program descriptor', () => {
  it('commits only the Savings family and hashes deterministically', () => {
    const descriptor = fixtureDescriptor()
    expect(descriptor.schema).toBe(PROGRAM_SCHEMA)
    expect(descriptor.templateVersion).toBe(SAVINGS_TEMPLATE)
    expect(descriptor.keys.recovery).toBe(PROGRAM_FIXTURE.recoveryPub)
    expect(Object.keys(descriptor)).not.toContain('daily')
    expect(Object.keys(descriptor.pending).sort()).toEqual([...FAMILY_KEYS].sort())
    expect(Object.keys(descriptor.quarantine).sort()).toEqual([...FAMILY_KEYS].sort())
    expect(descriptor.csv).toEqual(PROGRAM_CSV)
    expect(hashVaultProgramDescriptor(descriptor)).toHaveLength(64)
    expect(hashVaultProgramDescriptor(descriptor)).toBe(hashVaultProgramDescriptor(fixtureDescriptor()))
  })

  it('rejects a mutated tree and retired descriptor schema', () => {
    const mutated = fixtureDescriptor()
    mutated.pending['savings-phone'] = mutated.pending['savings-hardware']
    expect(() => validateVaultProgramDescriptor(mutated)).toThrow(/pending does not match rebuilt/)
    expect(() => validateVaultProgramDescriptor({ schema: 'arkade-vault/staged-v6' } as never)).toThrow(/schema/)
  })

  it('supports Savings without recovery and rejects forbidden family keys', () => {
    const descriptor = buildVaultProgramDescriptor({
      ...PROGRAM_FIXTURE,
      protectionTier: 'standard',
      recoveryPub: undefined,
    })
    expect(descriptor.keys.recovery).toBeUndefined()
    expect(Object.keys(descriptor.pending).sort()).toEqual(['savings-hardware', 'savings-phone'])
    expect(descriptor.quarantine['savings-phone'].guardians).toEqual(['hardware'])
    expect(() => buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, hardwarePub: FORBIDDEN_PUBLIC_KEY_2G })).toThrow(
      /forbidden/,
    )
  })

  it('rejects protection-tier and recovery-key substitution', () => {
    expect(() => buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, protectionTier: 'standard' })).toThrow(/Standard/)
    expect(() =>
      buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, protectionTier: 'advanced', recoveryPub: undefined }),
    ).toThrow(/Advanced/)
    const descriptor = fixtureDescriptor()
    expect(() => validateVaultProgramDescriptor({ ...descriptor, protectionTier: 'standard' })).toThrow(/Standard/)
  })

  it('binds a custom exposure policy while keeping release-managed fee scripts', () => {
    const standard = fixtureDescriptor()
    const customPolicy = {
      ...defaultSpendingPolicy(),
      txRecipientCapSats: 75_000,
      periodAllowanceSats: 300_000,
    }
    const custom = buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, spendingPolicy: customPolicy })

    expect(custom.savings).toEqual(standard.savings)
    expect(custom.policy.recipientCapSats).toBe(75_000)
    expect(custom.policy.periodAllowanceSats).toBe(300_000)
    expect(custom.policy.absoluteFeeCapSats).toBe(5_000)
    expect(custom.policy.feerateCapSatVb).toBe(10)
    expect(hashVaultProgramDescriptor(custom)).not.toBe(hashVaultProgramDescriptor(standard))

    expect(() =>
      buildVaultProgramDescriptor({
        ...PROGRAM_FIXTURE,
        spendingPolicy: { ...customPolicy, absoluteFeeCapSats: 9_000 },
      }),
    ).toThrow(/absolute fee cap/)
  })
})

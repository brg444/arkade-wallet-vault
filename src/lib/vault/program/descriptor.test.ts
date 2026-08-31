import { describe, expect, it } from 'vitest'
import { FORBIDDEN_PUBLIC_KEY_2G } from '../setupPlan'
import { defaultSpendingPolicy, spendingPolicyDigest } from '../spendingPolicy'
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
    const descriptor = buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, recoveryPub: undefined })
    expect(descriptor.keys.recovery).toBeUndefined()
    expect(Object.keys(descriptor.pending).sort()).toEqual(['savings-hardware', 'savings-phone'])
    expect(descriptor.quarantine['savings-phone'].guardians).toEqual(['hardware'])
    expect(() => buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, hardwarePub: FORBIDDEN_PUBLIC_KEY_2G })).toThrow(
      /forbidden/,
    )
  })

  it('binds selected fee policy into every Savings transition tree', () => {
    const standard = fixtureDescriptor()
    const flexiblePolicy = {
      ...defaultSpendingPolicy(),
      txRecipientCapSats: 250_000,
      periodAllowanceSats: 1_000_000,
      absoluteFeeCapSats: 10_000,
      feerateCapSatPerV: 20,
    }
    const flexible = buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, spendingPolicy: flexiblePolicy })

    expect(flexible.savings).not.toEqual(standard.savings)
    expect(flexible.policy.absoluteFeeCapSats).toBe(10_000)
    expect(flexible.policy.feerateCapSatVb).toBe(20)
    expect(hashVaultProgramDescriptor(flexible)).toBe(
      'cf5fb73ae35ce6b4c857a6ca79c4e872809ab9514e968afd1151b5bc091cf31e',
    )

    const tampered = structuredClone(flexible)
    const changedPolicy = { ...flexiblePolicy, absoluteFeeCapSats: 9_000 }
    tampered.policy.absoluteFeeCapSats = changedPolicy.absoluteFeeCapSats
    tampered.policy.digest = spendingPolicyDigest(changedPolicy)
    expect(() => validateVaultProgramDescriptor(tampered)).toThrow(/derived authorization scripts/)
  })
})

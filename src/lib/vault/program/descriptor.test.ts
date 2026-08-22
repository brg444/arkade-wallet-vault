import { describe, expect, it } from 'vitest'
import { FORBIDDEN_PUBLIC_KEY_2G } from '../setupPlan'
import { FAMILY_KEYS, PROGRAM_CSV, PROGRAM_SCHEMA, STAGED_TEMPLATE } from './constants'
import { buildVaultProgramDescriptor, hashVaultProgramDescriptor, validateVaultProgramDescriptor } from './descriptor'
import { PROGRAM_FIXTURE } from './fixtures'

function fixtureDescriptor() {
  return buildVaultProgramDescriptor(PROGRAM_FIXTURE)
}

describe('staged public descriptor', () => {
  it('rebuilds all 14 trees and hashes stably', () => {
    const d = fixtureDescriptor()
    expect(d.schema).toBe(PROGRAM_SCHEMA)
    expect(d.templateVersion).toBe(STAGED_TEMPLATE)
    expect(d.keys.recovery).toBe(PROGRAM_FIXTURE.recoveryPub)
    expect(d.daily.address).toBe('tb1p8qhq36ejt8z0lkyjna9lm0320pq7m25rjhjxvrx0vjefuv8sdh9qmrzlc4')
    expect(d.savings.address).toBe('tb1p9jm4xuxvlxy09t546zavpnh896v0pg7hhlg9e9nsetjzd8w9uzpq8nhljy')
    expect(d.quarantine['savings-hardware'].address).toBe(
      'tb1pyr7v22kneep409jsszn2lq4588p0lct2gjgwhxs209ytwt9whc6svljer7',
    )
    expect(d.pending['daily-recovery'].address).toBe('tb1pq94r43tszd3khj8ayc7vln3dr3f6q573yggv2hmgkddec3mclzlqs9cpd6')
    expect(hashVaultProgramDescriptor(d)).toBe('f2ad86beb90ddd5a572053c5694413ef3510198a6865cc64cd3fdd7d27011934')
    expect(d.p2a.valueSats).toBe(240)
    expect(d.tweaks.initiate.daily.phone).not.toEqual(d.tweaks.initiate.savings.phone)
    expect(FAMILY_KEYS.every((key) => d.pending[key] && d.quarantine[key])).toBe(true)
    expect(d.pending['hardware' as never]).toBeUndefined()
    expect(d.csv).toEqual(PROGRAM_CSV)
    expect(hashVaultProgramDescriptor(d)).toBe(hashVaultProgramDescriptor(fixtureDescriptor()))
    expect(hashVaultProgramDescriptor(d)).toHaveLength(64)
  })

  it('changes hash when recovery, a pending dest, or the template would change', () => {
    const original = hashVaultProgramDescriptor(fixtureDescriptor())
    const recovery = buildVaultProgramDescriptor({
      ...PROGRAM_FIXTURE,
      recoveryPub: PROGRAM_FIXTURE.vaultCosignerBase,
      vaultCosignerBase: PROGRAM_FIXTURE.recoveryPub,
    })
    expect(hashVaultProgramDescriptor(recovery)).not.toBe(original)
    const swapped = fixtureDescriptor()
    const dailyPending = swapped.pending['daily-phone']
    swapped.pending['daily-phone'] = swapped.pending['savings-phone']
    swapped.pending['savings-phone'] = dailyPending
    expect(() => validateVaultProgramDescriptor(swapped)).toThrow(/pending does not match rebuilt/)
  })

  it('allows skipping recovery and still refuses G/2G', () => {
    const skipped = buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, recoveryPub: undefined })
    expect(skipped.keys.recovery).toBeUndefined()
    expect(skipped.pending['daily-recovery']).toBeUndefined()
    expect(skipped.quarantine['daily-phone'].guardians).toEqual(['hardware'])
    expect(skipped.daily.address).not.toBe(fixtureDescriptor().daily.address)
    expect(() => buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, hardwarePub: FORBIDDEN_PUBLIC_KEY_2G })).toThrow(
      /forbidden/,
    )
    expect(() => validateVaultProgramDescriptor({ schema: 'retired' } as never)).toThrow(/schema/)
  })

  it('does not hash JSON stringification', () => {
    const d = fixtureDescriptor()
    expect(hashVaultProgramDescriptor(d)).not.toBe(JSON.stringify(d))
  })
})

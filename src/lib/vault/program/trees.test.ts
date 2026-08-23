import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { FORBIDDEN_PUBLIC_KEY_2G } from '../setupPlan'
import { P2A_OUTPUT_INDEX, P2A_SCRIPT_HEX, P2A_VALUE_SATS, PROGRAM_CSV, TRANSITION_SEQUENCE } from './constants'
import { contextInternalKey, encodeTreeContext } from './context'
import { PROGRAM_FIXTURE, PROGRAM_FIXTURE_FAMILY } from './fixtures'
import { assertTransitionScript } from './script'
import { tweakPair } from './tweak'
import { buildQuarantine, buildVaultProgramFamily, pendingDelay, quarantineGuardians } from './trees'

describe('Savings tree family', () => {
  it('separates claimants and excludes each suspected claimant from quarantine', () => {
    expect(quarantineGuardians('phone')).toEqual(['hardware', 'recovery'])
    expect(quarantineGuardians('hardware')).toEqual(['phone', 'recovery'])
    expect(quarantineGuardians('recovery')).toEqual(['phone', 'hardware'])
    const base = {
      vaultId: PROGRAM_FIXTURE.vaultId,
      phonePub: PROGRAM_FIXTURE.phonePub,
      hardwarePub: PROGRAM_FIXTURE.hardwarePub,
      recoveryPub: PROGRAM_FIXTURE.recoveryPub,
      network: PROGRAM_FIXTURE.network,
    }
    const phone = buildQuarantine({ ...base, claimant: 'phone' })
    const hardware = buildQuarantine({ ...base, claimant: 'hardware' })
    expect(phone.address).not.toBe(hardware.address)
    expect(hex.encode(phone.tapInternalKey!)).not.toBe(hex.encode(hardware.tapInternalKey!))
  })

  it('pins the three transition delays and funded P2A layout', () => {
    expect(pendingDelay('hardware')).toBe(PROGRAM_CSV.hardware)
    expect(pendingDelay('phone')).toBe(PROGRAM_CSV.phone)
    expect(pendingDelay('recovery')).toBe(PROGRAM_CSV.recovery)
    expect(P2A_SCRIPT_HEX).toBe('51024e73')
    expect(P2A_VALUE_SATS).toBe(240)
    expect(P2A_OUTPUT_INDEX).toBe(1)
    expect(TRANSITION_SEQUENCE).toBe(0xfffffffd)
  })

  it('uses a stable Savings-only context', () => {
    const a = encodeTreeContext({ vaultId: 'ab', claimant: 'phone' })
    const b = encodeTreeContext({ vaultId: 'ab', claimant: 'hardware' })
    expect(hex.encode(a)).not.toBe(hex.encode(b))
    expect(hex.encode(contextInternalKey({ vaultId: 'ab', claimant: 'phone' }))).not.toBe(
      hex.encode(contextInternalKey({ vaultId: 'ab', claimant: 'hardware' })),
    )
  })

  it('builds one Normal, three Pending, and three Quarantine trees', () => {
    const family = buildVaultProgramFamily(PROGRAM_FIXTURE_FAMILY)
    const addresses = [
      family.savings.address,
      ...Object.values(family.pending).map((tree) => tree.address),
      ...Object.values(family.quarantine).map((tree) => tree.address),
    ]
    expect(new Set(addresses).size).toBe(7)
    expect(family.savings.initiate).toHaveLength(3)
    expect(family.pending['savings-recovery'].delay).toBe(PROGRAM_CSV.recovery)
  })

  it('supports a two-key family when recovery is omitted', () => {
    const family = buildVaultProgramFamily({ ...PROGRAM_FIXTURE_FAMILY, recoveryPub: undefined })
    expect(family.savings.initiate).toHaveLength(2)
    expect(family.pending['savings-recovery']).toBeUndefined()
    expect(family.quarantine['savings-phone'].guardians).toEqual(['hardware'])
  })

  it('derives transition tweaks from exact scripts and rejects forbidden points', () => {
    const family = buildVaultProgramFamily(PROGRAM_FIXTURE_FAMILY)
    expect(family.initiateTweaks.phone).toEqual(
      tweakPair(
        PROGRAM_FIXTURE.vaultCosignerBase,
        PROGRAM_FIXTURE.arkadeCosignerBase,
        family.initiateAuth['savings-phone'],
      ),
    )
    expect(family.pendingTweaks['savings-phone']).toEqual(
      tweakPair(
        PROGRAM_FIXTURE.vaultCosignerBase,
        PROGRAM_FIXTURE.arkadeCosignerBase,
        family.clawbackAuth['savings-phone'],
      ),
    )
    for (const claimant of ['phone', 'hardware', 'recovery'] as const) {
      const key = `savings-${claimant}` as const
      assertTransitionScript(family.initiateAuth[key], hex.encode(family.pending[key].script), claimant === 'phone')
      assertTransitionScript(family.clawbackAuth[key], hex.encode(family.quarantine[key].script), false)
    }
    expect(() => buildVaultProgramFamily({ ...PROGRAM_FIXTURE_FAMILY, hardwarePub: FORBIDDEN_PUBLIC_KEY_2G })).toThrow(
      /forbidden/,
    )
  })
})

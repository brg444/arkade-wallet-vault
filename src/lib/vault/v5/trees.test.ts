import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { P2A_OUTPUT_INDEX, P2A_SCRIPT_HEX, P2A_VALUE_SATS, TRANSITION_SEQUENCE, V5_CSV } from './constants'
import { contextInternalKey, encodeTreeContext } from './context'
import { UNSAFE_GENERATOR_2G } from '../setupPlan'
import { V5_FIXTURE, V5_FIXTURE_FAMILY } from './fixtures'
import { assertTransitionScript } from './script'
import { buildNormal, buildPending, buildQuarantine, buildV5Family, pendingDelay, quarantineGuardians } from './trees'

const PHONE = V5_FIXTURE.phonePub
const HARDWARE = V5_FIXTURE.hardwarePub
const RECOVERY = V5_FIXTURE.recoveryPub
const VAULT_TWEAK = V5_FIXTURE.routineVault
const ARKADE_TWEAK = V5_FIXTURE.routineArkade
const initiate = V5_FIXTURE.initiate

const base = {
  vaultId: V5_FIXTURE.vaultId,
  phonePub: PHONE,
  hardwarePub: HARDWARE,
  recoveryPub: RECOVERY,
  network: V5_FIXTURE.network,
}

describe('v5 quarantine', () => {
  it('excludes the suspected claimant', () => {
    expect(quarantineGuardians('phone')).toEqual(['hardware', 'recovery'])
    expect(quarantineGuardians('hardware')).toEqual(['phone', 'recovery'])
    expect(quarantineGuardians('recovery')).toEqual(['phone', 'hardware'])
  })

  it('gives Daily and Savings different addresses for the same keys', () => {
    const daily = buildQuarantine({ ...base, kind: 'daily', claimant: 'recovery' })
    const savings = buildQuarantine({ ...base, kind: 'savings', claimant: 'recovery' })
    expect(daily.address).not.toBe(savings.address)
    expect(hex.encode(daily.tapInternalKey!)).not.toBe(hex.encode(savings.tapInternalKey!))
    expect(daily.guardians).toEqual(['phone', 'hardware'])
  })

  it('gives different claimants different quarantine addresses', () => {
    const phone = buildQuarantine({ ...base, kind: 'savings', claimant: 'phone' })
    const hardware = buildQuarantine({ ...base, kind: 'savings', claimant: 'hardware' })
    expect(phone.address).not.toBe(hardware.address)
    expect(phone.guardians).toEqual(['hardware', 'recovery'])
    expect(hardware.guardians).toEqual(['phone', 'recovery'])
  })
})

describe('v5 pending', () => {
  it('starts CSV only on the pending output', () => {
    expect(pendingDelay('hardware')).toBe(V5_CSV.hardware)
    expect(pendingDelay('phone')).toBe(V5_CSV.phone)
    expect(pendingDelay('recovery')).toBe(V5_CSV.recovery)
  })

  it('separates Daily and Savings pending addresses', () => {
    const args = { ...base, vaultTweak: VAULT_TWEAK, arkadeTweak: ARKADE_TWEAK, claimant: 'hardware' as const }
    const daily = buildPending({ ...args, kind: 'daily' })
    const savings = buildPending({ ...args, kind: 'savings' })
    expect(daily.address).not.toBe(savings.address)
    expect(daily.delay).toBe(6)
    expect(daily.clawbacks).toHaveLength(2)
  })
})

describe('v5 context NUMS', () => {
  it('encodes a stable context payload', () => {
    expect(hex.encode(encodeTreeContext({ vaultId: 'ab', kind: 'daily', claimant: 'phone' }))).toBe(
      hex.encode(encodeTreeContext({ vaultId: 'ab', kind: 'daily', claimant: 'phone' })),
    )
    expect(hex.encode(contextInternalKey({ vaultId: 'ab', kind: 'daily', claimant: 'phone' }))).not.toBe(
      hex.encode(contextInternalKey({ vaultId: 'ab', kind: 'savings', claimant: 'phone' })),
    )
  })
})

describe('v5 normal', () => {
  const args = {
    ...base,
    initiate,
    routineVault: VAULT_TWEAK,
    routineArkade: ARKADE_TWEAK,
  }

  it('Daily has a routine leaf and Savings does not', () => {
    const daily = buildNormal({ ...args, kind: 'daily' })
    const savings = buildNormal({ ...args, kind: 'savings', routineVault: undefined, routineArkade: undefined })
    expect(daily.routine).toBeTruthy()
    expect(savings.routine).toBeUndefined()
    expect(daily.initiate).toHaveLength(3)
    expect(savings.initiate).toHaveLength(3)
    expect(daily.address).not.toBe(savings.address)
  })

  it('refuses routine tweaks on Savings and missing tweaks on Daily', () => {
    expect(() => buildNormal({ ...args, kind: 'savings' })).toThrow(/must not include routine/)
    expect(() => buildNormal({ ...args, kind: 'daily', routineVault: undefined, routineArkade: undefined })).toThrow(
      /routine tweaks required/,
    )
  })

  it('refuses colliding x-only roles', () => {
    expect(() =>
      buildNormal({
        ...args,
        kind: 'daily',
        recoveryPub: HARDWARE,
      }),
    ).toThrow(/x-only distinct/)
  })

  it('builds a full family with 2 normals, 6 pending, 6 quarantine', () => {
    const family = buildV5Family(V5_FIXTURE_FAMILY)
    const addresses = [
      family.daily.address,
      family.savings.address,
      ...Object.values(family.quarantine).map((t) => t.address),
      ...Object.values(family.pending).map((t) => t.address),
    ]
    expect(new Set(addresses).size).toBe(14)
    expect(family.daily.routine).toBeTruthy()
    expect(family.savings.routine).toBeUndefined()
    expect(family.daily.address).toBe('tb1phsgz9667w8ksaaeseglzc9mrd7gztfjkkpvkuufs0xf7znkn8lmsjsxuq9')
    expect(family.savings.address).toBe('tb1p75uz4h76n2cvqezj0euw0mlenefv4v599encenzhf5raaa0ts7sqcjvxxz')
    expect(family.quarantine['savings-hardware'].address).toBe(
      'tb1p6hetvtpddk0sgpfyv7nmtrh7dfzxqu2l04d26zcrhlyy3pdwrpmsd8sw5g',
    )
    expect(family.pending['daily-recovery'].address).toBe(
      'tb1pcg2wwsrjklt6mclhzxp6l72843frqd0gf3lp982f3u6hr67f0tfsm0xaww',
    )
  })

  it('refuses reused initiate tweaks as pending tweaks and G/2G', () => {
    expect(() =>
      buildV5Family({
        ...V5_FIXTURE_FAMILY,
        pending: V5_FIXTURE.initiate,
      }),
    ).toThrow(/distinct/)
    expect(() => buildV5Family({ ...V5_FIXTURE_FAMILY, hardwarePub: UNSAFE_GENERATOR_2G })).toThrow(/forbidden/)
  })
})

describe('v5 P2A lock', () => {
  it('pins the Core P2A script at output 1 with zero value', () => {
    expect(P2A_SCRIPT_HEX).toBe('51024e73')
    expect(P2A_VALUE_SATS).toBe(0)
    expect(P2A_OUTPUT_INDEX).toBe(1)
    expect(TRANSITION_SEQUENCE).toBe(0xfffffffd)
  })
})

describe('v5 transition dest wiring', () => {
  it('pins each initiate dest to that Pending and each clawback dest to that Quarantine', () => {
    const family = buildV5Family(V5_FIXTURE_FAMILY)
    for (const kind of ['daily', 'savings'] as const) {
      for (const claimant of ['phone', 'hardware', 'recovery'] as const) {
        const key = `${kind}-${claimant}` as const
        assertTransitionScript(family.initiateAuth[key], hex.encode(family.pending[key].script), false)
        assertTransitionScript(family.clawbackAuth[key], hex.encode(family.quarantine[key].script), false)
      }
    }
    expect(hex.encode(family.initiateAuth['daily-phone'])).not.toBe(hex.encode(family.initiateAuth['savings-phone']))
    expect(hex.encode(family.clawbackAuth['savings-hardware'])).not.toBe(
      hex.encode(family.clawbackAuth['savings-phone']),
    )
  })
})

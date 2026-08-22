import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { P2A_OUTPUT_INDEX, P2A_SCRIPT_HEX, P2A_VALUE_SATS, TRANSITION_SEQUENCE, PROGRAM_CSV } from './constants'
import { contextInternalKey, encodeTreeContext } from './context'
import { FORBIDDEN_PUBLIC_KEY_2G } from '../setupPlan'
import { compressedFromScalar, PROGRAM_FIXTURE, PROGRAM_FIXTURE_FAMILY } from './fixtures'
import { assertTransitionScript } from './script'
import { tweakPair } from './tweak'
import {
  buildNormal,
  buildPending,
  buildQuarantine,
  buildVaultProgramFamily,
  pendingDelay,
  quarantineGuardians,
} from './trees'

const PHONE = PROGRAM_FIXTURE.phonePub
const HARDWARE = PROGRAM_FIXTURE.hardwarePub
const RECOVERY = PROGRAM_FIXTURE.recoveryPub
const VAULT_TWEAK = PROGRAM_FIXTURE.routineVault
const ARKADE_TWEAK = PROGRAM_FIXTURE.routineArkade
const initiate = {
  phone: { vault: compressedFromScalar(8), arkade: compressedFromScalar(9) },
  hardware: { vault: compressedFromScalar(10), arkade: compressedFromScalar(11) },
  recovery: { vault: compressedFromScalar(12), arkade: compressedFromScalar(13) },
}

const base = {
  vaultId: PROGRAM_FIXTURE.vaultId,
  phonePub: PHONE,
  hardwarePub: HARDWARE,
  recoveryPub: RECOVERY,
  network: PROGRAM_FIXTURE.network,
}

describe('staged quarantine', () => {
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

describe('staged pending', () => {
  it('starts CSV only on the pending output', () => {
    expect(pendingDelay('hardware')).toBe(PROGRAM_CSV.hardware)
    expect(pendingDelay('phone')).toBe(PROGRAM_CSV.phone)
    expect(pendingDelay('recovery')).toBe(PROGRAM_CSV.recovery)
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

describe('staged context NUMS', () => {
  it('encodes a stable context payload', () => {
    expect(hex.encode(encodeTreeContext({ vaultId: 'ab', kind: 'daily', claimant: 'phone' }))).toBe(
      hex.encode(encodeTreeContext({ vaultId: 'ab', kind: 'daily', claimant: 'phone' })),
    )
    expect(hex.encode(contextInternalKey({ vaultId: 'ab', kind: 'daily', claimant: 'phone' }))).not.toBe(
      hex.encode(contextInternalKey({ vaultId: 'ab', kind: 'savings', claimant: 'phone' })),
    )
  })
})

describe('staged normal', () => {
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

  it('builds a two-guardian family when recovery is omitted', () => {
    const family = buildVaultProgramFamily({ ...PROGRAM_FIXTURE_FAMILY, recoveryPub: undefined })
    expect(family.daily.initiate).toHaveLength(2)
    expect(family.savings.initiate).toHaveLength(2)
    expect(family.pending['daily-recovery']).toBeUndefined()
    expect(family.quarantine['daily-phone'].guardians).toEqual(['hardware'])
    const addresses = [
      family.daily.address,
      family.savings.address,
      ...Object.values(family.quarantine).map((t) => t.address),
      ...Object.values(family.pending).map((t) => t.address),
    ]
    expect(new Set(addresses).size).toBe(10)
  })

  it('builds a full family with 2 normals, 6 pending, 6 quarantine', () => {
    const family = buildVaultProgramFamily(PROGRAM_FIXTURE_FAMILY)
    const addresses = [
      family.daily.address,
      family.savings.address,
      ...Object.values(family.quarantine).map((t) => t.address),
      ...Object.values(family.pending).map((t) => t.address),
    ]
    expect(new Set(addresses).size).toBe(14)
    expect(family.daily.routine).toBeTruthy()
    expect(family.savings.routine).toBeUndefined()
    expect(family.daily.address).toBe('tb1p8qhq36ejt8z0lkyjna9lm0320pq7m25rjhjxvrx0vjefuv8sdh9qmrzlc4')
    expect(family.savings.address).toBe('tb1p9jm4xuxvlxy09t546zavpnh896v0pg7hhlg9e9nsetjzd8w9uzpq8nhljy')
    expect(family.quarantine['savings-hardware'].address).toBe(
      'tb1pyr7v22kneep409jsszn2lq4588p0lct2gjgwhxs209ytwt9whc6svljer7',
    )
    expect(family.pending['daily-recovery'].address).toBe(
      'tb1pq94r43tszd3khj8ayc7vln3dr3f6q573yggv2hmgkddec3mclzlqs9cpd6',
    )
  })

  it('derives each tweak from its authorization script and refuses G/2G', () => {
    const family = buildVaultProgramFamily(PROGRAM_FIXTURE_FAMILY)
    expect(family.initiateTweaks.daily.phone).toEqual(
      tweakPair(
        PROGRAM_FIXTURE.vaultCosignerBase,
        PROGRAM_FIXTURE.arkadeCosignerBase,
        family.initiateAuth['daily-phone'],
      ),
    )
    expect(family.initiateTweaks.savings.phone).toEqual(
      tweakPair(
        PROGRAM_FIXTURE.vaultCosignerBase,
        PROGRAM_FIXTURE.arkadeCosignerBase,
        family.initiateAuth['savings-phone'],
      ),
    )
    expect(family.initiateTweaks.daily.phone).not.toEqual(family.initiateTweaks.savings.phone)
    expect(family.pendingTweaks['daily-phone']).toEqual(
      tweakPair(
        PROGRAM_FIXTURE.vaultCosignerBase,
        PROGRAM_FIXTURE.arkadeCosignerBase,
        family.clawbackAuth['daily-phone'],
      ),
    )
    expect(family.pendingTweaks['daily-phone']).not.toEqual(family.pendingTweaks['savings-phone'])
    expect(() => buildVaultProgramFamily({ ...PROGRAM_FIXTURE_FAMILY, hardwarePub: FORBIDDEN_PUBLIC_KEY_2G })).toThrow(
      /forbidden/,
    )
  })
})

describe('staged P2A lock', () => {
  it('pins a funded Core P2A at output 1', () => {
    expect(P2A_SCRIPT_HEX).toBe('51024e73')
    expect(P2A_VALUE_SATS).toBe(240)
    expect(P2A_OUTPUT_INDEX).toBe(1)
    expect(TRANSITION_SEQUENCE).toBe(0xfffffffd)
  })
})

describe('staged transition dest wiring', () => {
  it('pins dest, packet, and PhoneDirect only on phone initiation', () => {
    const family = buildVaultProgramFamily(PROGRAM_FIXTURE_FAMILY)
    for (const kind of ['daily', 'savings'] as const) {
      for (const claimant of ['phone', 'hardware', 'recovery'] as const) {
        const key = `${kind}-${claimant}` as const
        assertTransitionScript(family.initiateAuth[key], hex.encode(family.pending[key].script), claimant === 'phone')
        assertTransitionScript(family.clawbackAuth[key], hex.encode(family.quarantine[key].script), false)
      }
    }
    expect(hex.encode(family.initiateAuth['daily-phone'])).not.toBe(hex.encode(family.initiateAuth['savings-phone']))
    expect(hex.encode(family.clawbackAuth['savings-hardware'])).not.toBe(
      hex.encode(family.clawbackAuth['savings-phone']),
    )
  })
})

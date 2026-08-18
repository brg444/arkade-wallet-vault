import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { P2A_OUTPUT_INDEX, P2A_SCRIPT_HEX, P2A_VALUE_SATS, V5_CSV } from './constants'
import { contextInternalKey, encodeTreeContext } from './context'
import { buildPending, buildQuarantine, pendingDelay, quarantineGuardians } from './trees'

const PHONE = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'
const HARDWARE = '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13'
const RECOVERY = '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4'
const VAULT_TWEAK = '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556'
const ARKADE_TWEAK = '025cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc'

const base = {
  vaultId: 'aabbccddeeff00112233445566778899',
  phonePub: PHONE,
  hardwarePub: HARDWARE,
  recoveryPub: RECOVERY,
  network: 'mutinynet',
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

describe('v5 P2A lock', () => {
  it('pins the Core P2A script at output 1 with zero value', () => {
    expect(P2A_SCRIPT_HEX).toBe('51024e73')
    expect(P2A_VALUE_SATS).toBe(0)
    expect(P2A_OUTPUT_INDEX).toBe(1)
  })
})

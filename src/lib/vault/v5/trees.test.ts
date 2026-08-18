import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { P2A_OUTPUT_INDEX, P2A_SCRIPT_HEX, P2A_VALUE_SATS, V5_CSV } from './constants'
import { contextInternalKey, encodeTreeContext } from './context'
import { buildNormal, buildPending, buildQuarantine, buildV5Family, pendingDelay, quarantineGuardians } from './trees'

const PHONE = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'
const HARDWARE = '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13'
const RECOVERY = '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4'
const VAULT_TWEAK = '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556'
const ARKADE_TWEAK = '025cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc'
const initiate = {
  phone: {
    vault: '022f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a01',
    arkade: '03acd484e2f0c7f65309ad178a9f559abde09796974c57e714c35f110dfc27ccbe',
  },
  hardware: {
    vault: '03a0434d9e47f3c86235477c7b1ae6ae5d3442d49b1943c2b752a68e2a47e247c7',
    arkade: '03774ae7f858a9411e5ef4246b70c65aac5649980be5c17891bbec17895da008cb',
  },
  recovery: {
    vault: '03d01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a',
    arkade: '03f28773c2d975288bc7d1d205c3748651b075fbc6610e58cddeeddf8f19405aa8',
  },
}

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
    const family = buildV5Family({
      ...base,
      routineVault: VAULT_TWEAK,
      routineArkade: ARKADE_TWEAK,
      initiate,
      pending: initiate,
    })
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
      'tb1p0a8umug8skudg8c4jr7pldfl8tg3xzmp4tgqcwddy2c5k3jc5qpqncv4fn',
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

import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { hashDescriptor, validateDescriptor } from '../descriptor'
import { sampleDescriptor } from '../sample'
import { UNSAFE_GENERATOR_2G } from '../setupPlan'
import { FAMILY_KEYS, V5_CSV, V5_SCHEMA, V5_TEMPLATE } from './constants'
import { buildV5Descriptor, hashV5Descriptor, recoveryXOnly, validateV5Descriptor } from './descriptor'
import { V5_FIXTURE, scalarSecret } from './fixtures'
import { recoveryPoPDigest, signRecoveryPoP, verifyRecoveryPoP } from './pop'

function fixtureDescriptor() {
  return buildV5Descriptor(V5_FIXTURE)
}

describe('v5 public descriptor', () => {
  it('rebuilds all 14 trees and hashes stably', () => {
    const d = fixtureDescriptor()
    expect(d.schema).toBe(V5_SCHEMA)
    expect(d.templateVersion).toBe(V5_TEMPLATE)
    expect(d.keys.recovery).toBe(V5_FIXTURE.recoveryPub)
    expect(d.daily.address).toBe('tb1pp8ctfhpqwkxnpuyk2fpkfn547a2wnc2lt0l2jxt608ehrwdyquyqtm34r8')
    expect(d.savings.address).toBe('tb1pze88nd4d9ny6tmp36fwre8e7dhphap52hkx766f5hazfms9gjs7qx3nkjs')
    expect(d.quarantine['savings-hardware'].address).toBe(
      'tb1p6hetvtpddk0sgpfyv7nmtrh7dfzxqu2l04d26zcrhlyy3pdwrpmsd8sw5g',
    )
    expect(d.pending['daily-recovery'].address).toBe('tb1pauglx20q6rfkf8wq3sy3z02dn404zzrtluspd6mt6uhclxgkwqpsr48veg')
    expect(hashV5Descriptor(d)).toBe('f864eb57894578ef152e1e6d19550206b2c384d14e738c0d3206dde02e6ddcfa')
    expect(d.p2a.valueSats).toBe(240)
    expect(d.tweaks.initiate.daily.phone).not.toEqual(d.tweaks.initiate.savings.phone)
    expect(FAMILY_KEYS.every((key) => d.pending[key] && d.quarantine[key])).toBe(true)
    expect(d.pending['hardware' as never]).toBeUndefined()
    expect(d.csv).toEqual(V5_CSV)
    expect(hashV5Descriptor(d)).toBe(hashV5Descriptor(fixtureDescriptor()))
    expect(hashV5Descriptor(d)).toHaveLength(64)
  })

  it('changes hash when recovery, a pending dest, or the template would change', () => {
    const original = hashV5Descriptor(fixtureDescriptor())
    const recovery = buildV5Descriptor({
      ...V5_FIXTURE,
      recoveryPub: V5_FIXTURE.vaultCosignerBase,
      vaultCosignerBase: V5_FIXTURE.recoveryPub,
    })
    expect(hashV5Descriptor(recovery)).not.toBe(original)
    const swapped = fixtureDescriptor()
    const dailyPending = swapped.pending['daily-phone']
    swapped.pending['daily-phone'] = swapped.pending['savings-phone']
    swapped.pending['savings-phone'] = dailyPending
    expect(() => validateV5Descriptor(swapped)).toThrow(/pending does not match rebuilt/)
    expect(original).not.toBe(hashDescriptor(sampleDescriptor()))
  })

  it('rejects missing recovery and G/2G', () => {
    expect(() => buildV5Descriptor({ ...V5_FIXTURE, recoveryPub: '' })).toThrow(/recovery/)
    expect(() => buildV5Descriptor({ ...V5_FIXTURE, hardwarePub: UNSAFE_GENERATOR_2G })).toThrow(/forbidden/)
    const v4 = sampleDescriptor()
    expect(() => validateDescriptor(v4)).not.toThrow()
    expect(() => validateV5Descriptor(v4 as never)).toThrow(/schema/)
  })

  it('does not hash JSON stringification', () => {
    const d = fixtureDescriptor()
    expect(hashV5Descriptor(d)).not.toBe(JSON.stringify(d))
  })
})

describe('v5 recovery PoP', () => {
  it('signs the descriptor hash with the recovery key', () => {
    const d = fixtureDescriptor()
    const digest = recoveryPoPDigest({
      vaultId: d.vaultId,
      inviteHandle: 'invite-1',
      recoveryXOnly: recoveryXOnly(d),
      descriptorHash: hashV5Descriptor(d),
    })
    expect(digest).toHaveLength(32)
    const sig = signRecoveryPoP(scalarSecret(5), digest)
    expect(verifyRecoveryPoP(sig, digest, d.keys.recovery)).toBe(true)
    const other = recoveryPoPDigest({
      vaultId: d.vaultId,
      inviteHandle: 'invite-2',
      recoveryXOnly: recoveryXOnly(d),
      descriptorHash: hashV5Descriptor(d),
    })
    expect(hex.encode(other)).not.toBe(hex.encode(digest))
    expect(verifyRecoveryPoP(sig, other, d.keys.recovery)).toBe(false)
  })

  it('refuses an empty invite', () => {
    expect(() =>
      recoveryPoPDigest({
        vaultId: V5_FIXTURE.vaultId,
        inviteHandle: '  ',
        recoveryXOnly: '11'.repeat(32),
        descriptorHash: '22'.repeat(32),
      }),
    ).toThrow(/invite/)
  })
})

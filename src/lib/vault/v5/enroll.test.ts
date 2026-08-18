import { hex } from '@scure/base'
import { TEST_NETWORK, WIF } from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'
import { sampleDescriptor } from '../sample'
import { bytesToHex } from '../hex'
import { buildV5Descriptor, hashV5Descriptor, recoveryXOnly } from './descriptor'
import { parseRecoverySecret, requireV5ProposedDescriptor, signEnrollmentRecoveryPoP } from './enroll'
import { V5_FIXTURE, scalarSecret } from './fixtures'
import { recoveryPoPDigest, verifyRecoveryPoP } from './pop'

describe('v5 enrollment proof', () => {
  it('rejects a leftover propose and signs recovery PoP on v5', () => {
    const leftover = sampleDescriptor()
    expect(() => requireV5ProposedDescriptor(leftover, 'aa'.repeat(32))).toThrow(/v5 vault/)
    const skipped = buildV5Descriptor({ ...V5_FIXTURE, recoveryPub: undefined })
    expect(skipped.keys.recovery).toBeUndefined()
    expect(requireV5ProposedDescriptor(skipped, hashV5Descriptor(skipped)).vaultId).toBe(skipped.vaultId)
    const descriptor = buildV5Descriptor(V5_FIXTURE)
    const hash = hashV5Descriptor(descriptor)
    expect(() => requireV5ProposedDescriptor(descriptor, '00'.repeat(32))).toThrow(/hash/)
    expect(requireV5ProposedDescriptor(descriptor, hash).vaultId).toBe(descriptor.vaultId)
    const proof = signEnrollmentRecoveryPoP({
      descriptor,
      inviteHandle: 'invite-1',
      recoverySecret: scalarSecret(5),
    })
    expect(proof.descriptorHash).toBe(hash)
    expect(proof.recoveryXOnly).toBe(recoveryXOnly(descriptor))
    const digest = recoveryPoPDigest({
      vaultId: descriptor.vaultId,
      inviteHandle: 'invite-1',
      recoveryXOnly: proof.recoveryXOnly,
      descriptorHash: hash,
    })
    expect(verifyRecoveryPoP(hex.decode(proof.recoveryPoP), digest, descriptor.keys.recovery)).toBe(true)
    expect(() =>
      signEnrollmentRecoveryPoP({
        descriptor,
        inviteHandle: 'invite-1',
        recoverySecret: scalarSecret(4),
      }),
    ).toThrow(/does not match/)
  })

  it('parses a 32-byte recovery secret or WIF', () => {
    const secret = scalarSecret(5)
    expect(bytesToHex(parseRecoverySecret(bytesToHex(secret)))).toBe(bytesToHex(secret))
    const wif = WIF(TEST_NETWORK).encode(secret)
    expect(bytesToHex(parseRecoverySecret(wif))).toBe(bytesToHex(secret))
    expect(() => parseRecoverySecret('aa')).toThrow(/hex or WIF/)
  })
})

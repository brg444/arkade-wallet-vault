import { hex } from '@scure/base'
import { Transaction } from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'
import { type Claimant } from './constants'
import { PROGRAM_FIXTURE, PROGRAM_FIXTURE_FAMILY, scalarSecret } from './fixtures'
import {
  acceptGuardianExitSignature,
  assertGuardianExitPreserved,
  assertGuardianExitSigners,
  describeGuardianExitSigners,
  finalizeGuardianExit,
  inspectGuardianExitPsbt,
  requiredGuardianExitSigners,
  signGuardianExitPsbt,
} from './guardianExit'
import { buildGuardianExitPsbt } from './spend'
import { buildVaultProgramFamily } from './trees'

const COIN = { txid: 'cc'.repeat(32), vout: 0, value: 40_000 }
const SECRETS: Record<Claimant, Uint8Array> = {
  phone: scalarSecret(3),
  hardware: scalarSecret(4),
  recovery: scalarSecret(5),
}

const CASES: { claimant: Claimant; hasRecovery: boolean; want: Claimant[] }[] = [
  { claimant: 'phone', hasRecovery: true, want: ['hardware', 'recovery'] },
  { claimant: 'hardware', hasRecovery: true, want: ['phone', 'recovery'] },
  { claimant: 'recovery', hasRecovery: true, want: ['phone', 'hardware'] },
  { claimant: 'phone', hasRecovery: false, want: ['hardware'] },
  { claimant: 'hardware', hasRecovery: false, want: ['phone'] },
]

describe('Savings guardian-exit signers', () => {
  it.each(CASES)(
    'requires $want when $claimant started and recovery=$hasRecovery',
    ({ claimant, hasRecovery, want }) => {
      expect(requiredGuardianExitSigners(claimant, hasRecovery)).toEqual(want)
      expect(() => assertGuardianExitSigners(claimant, want)).not.toThrow()
      expect(() => assertGuardianExitSigners(claimant, [...want, claimant])).toThrow(/started recovery/)
    },
  )

  it('names the remaining keys in product language', () => {
    expect(describeGuardianExitSigners(['hardware'])).toBe('Hardware')
    expect(describeGuardianExitSigners(['phone', 'recovery'])).toBe('This device and Recovery')
    expect(describeGuardianExitSigners(['phone', 'hardware'])).toBe('This device and Hardware')
  })

  it.each(CASES)(
    'signs and finalizes $claimant-initiated cancel (recovery=$hasRecovery)',
    ({ claimant, hasRecovery, want }) => {
      const family = buildVaultProgramFamily({
        ...PROGRAM_FIXTURE_FAMILY,
        recoveryPub: hasRecovery ? PROGRAM_FIXTURE.recoveryPub : undefined,
      })
      const dest = family.quarantine[`savings-${claimant}`].address
      const built = buildGuardianExitPsbt({
        family,
        claimant,
        coin: COIN,
        destAddress: dest,
        feeSats: 500,
        network: PROGRAM_FIXTURE.network,
      })
      const unsigned = inspectGuardianExitPsbt(built.psbtHex)
      expect(unsigned.signatures).toBe(0)
      expect(unsigned.destSats).toBe(39_500)
      let psbt = built.psbtHex
      for (const role of want) {
        const before = psbt
        psbt = signGuardianExitPsbt(psbt, SECRETS[role])
        expect(acceptGuardianExitSignature(before, psbt, PROGRAM_FIXTURE[`${role}Pub`])).toBe(psbt)
        assertGuardianExitPreserved(built.psbtHex, psbt)
      }
      expect(inspectGuardianExitPsbt(psbt).signatures).toBe(want.length)
      expect(() => signGuardianExitPsbt(psbt, SECRETS[claimant])).toThrow(/remaining cancel signer/)
      const done = finalizeGuardianExit(psbt, want.length)
      expect(done.txHex.length).toBeGreaterThan(0)
      expect(done.txid).toMatch(/^[0-9a-f]{64}$/)
      expect(hex.decode(done.txHex).length).toBeGreaterThan(100)
    },
  )

  it('rejects an invalid imported guardian signature', () => {
    const family = buildVaultProgramFamily(PROGRAM_FIXTURE_FAMILY)
    const built = buildGuardianExitPsbt({
      family,
      claimant: 'phone',
      coin: COIN,
      destAddress: family.quarantine['savings-phone'].address,
      feeSats: 500,
      network: PROGRAM_FIXTURE.network,
    })
    const signed = Transaction.fromPSBT(hex.decode(signGuardianExitPsbt(built.psbtHex, SECRETS.hardware)))
    const [data] = signed.getInput(0).tapScriptSig![0]
    const internal = signed as unknown as { inputs: ReturnType<Transaction['getInput']>[] }
    internal.inputs[0].tapScriptSig = [[data, new Uint8Array(64)]]
    expect(() =>
      acceptGuardianExitSignature(built.psbtHex, hex.encode(signed.toPSBT()), PROGRAM_FIXTURE.hardwarePub),
    ).toThrow(/Invalid signature/)
  })
})

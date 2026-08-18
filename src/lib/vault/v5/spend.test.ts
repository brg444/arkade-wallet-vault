import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { Transaction } from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'
import { P2A_SCRIPT_HEX, P2A_VALUE_SATS, TRANSITION_SEQUENCE, V5_CSV, WITNESS_BYTES_399 } from './constants'
import { V5_FIXTURE, V5_FIXTURE_FAMILY, scalarSecret } from './fixtures'
import { buildClaimPsbt, buildClawbackPsbt, buildInitiatePsbt, inspectClaimPsbt, inspectTransitionPsbt } from './spend'
import { buildV5Family } from './trees'
import { tweakByArkScript, tweakPrivateKey } from './tweak'

const TX_OPTS = { version: 2, allowUnknownInputs: true, allowUnknownOutputs: true } as const
const COIN = { txid: '11'.repeat(32), vout: 0, value: 50_000 }

function family() {
  return buildV5Family(V5_FIXTURE_FAMILY)
}

function signPsbt(psbtHex: string, ...secrets: Uint8Array[]) {
  let hexPsbt = psbtHex
  for (const secret of secrets) {
    const tx = Transaction.fromPSBT(hex.decode(hexPsbt), TX_OPTS)
    tx.sign(secret)
    hexPsbt = hex.encode(tx.toPSBT())
  }
  const tx = Transaction.fromPSBT(hex.decode(hexPsbt), TX_OPTS)
  tx.finalize()
  const raw = tx.extract()
  return { txHex: hex.encode(raw), txid: tx.id, raw }
}

describe('v5 initiate / clawback / claim PSBTs', () => {
  it('initiates to the matching Pending with dest, funded P2A, and packet', () => {
    const built = family()
    const psbt = buildInitiatePsbt({
      family: built,
      kind: 'savings',
      claimant: 'hardware',
      coin: COIN,
      feeSats: 500,
    })
    const view = inspectTransitionPsbt(psbt.psbtHex)
    expect(view.version).toBe(2)
    expect(view.sequence).toBe(TRANSITION_SEQUENCE)
    expect(view.destScript).toBe(hex.encode(built.pending['savings-hardware'].script))
    expect(view.destSats).toBe(50_000 - 500 - P2A_VALUE_SATS)
    expect(view.p2aSats).toBe(240)
    expect(psbt.destAddress).toBe(built.pending['savings-hardware'].address)
    expect(view.packetScript.startsWith('6a')).toBe(true)
  })

  it('clawback lands in the claimant-specific Quarantine and refuses the suspect', () => {
    const built = family()
    const psbt = buildClawbackPsbt({
      family: built,
      kind: 'savings',
      claimant: 'hardware',
      guardian: 'phone',
      coin: COIN,
      feeSats: 500,
    })
    const view = inspectTransitionPsbt(psbt.psbtHex)
    expect(view.destScript).toBe(hex.encode(built.quarantine['savings-hardware'].script))
    expect(built.quarantine['savings-hardware'].guardians).toEqual(['phone', 'recovery'])
    expect(() =>
      buildClawbackPsbt({
        family: built,
        kind: 'savings',
        claimant: 'hardware',
        guardian: 'hardware',
        coin: COIN,
        feeSats: 500,
      }),
    ).toThrow(/guardian/)
  })

  it('claims serverlessly with the pending CSV and an unpinned dest', () => {
    const built = family()
    const dest = built.daily.address
    const psbt = buildClaimPsbt({
      family: built,
      kind: 'savings',
      claimant: 'recovery',
      coin: COIN,
      destAddress: dest,
      feeSats: 400,
      network: V5_FIXTURE.network,
    })
    const view = inspectClaimPsbt(psbt.psbtHex)
    expect(view.sequence).toBe(V5_CSV.recovery)
    expect(view.destSats).toBe(49_600)
    expect(view.sequence).not.toBe(TRANSITION_SEQUENCE)
  })

  it('signs and finalizes a savings hardware initiate with derived tweak keys', () => {
    const built = family()
    const auth = built.initiateAuth['savings-hardware']
    const psbt = buildInitiatePsbt({
      family: built,
      kind: 'savings',
      claimant: 'hardware',
      coin: COIN,
      feeSats: 500,
    })
    const vaultPriv = tweakPrivateKey(scalarSecret(14), auth)
    const arkadePriv = tweakPrivateKey(scalarSecret(15), auth)
    expect(hex.encode(secp256k1.getPublicKey(vaultPriv, true)).slice(2)).toBe(
      tweakByArkScript(V5_FIXTURE.vaultCosignerBase, auth).slice(2),
    )
    const { raw } = signPsbt(psbt.psbtHex, scalarSecret(4), vaultPriv, arkadePriv)
    const tx = Transaction.fromRaw(raw, TX_OPTS)
    expect(tx.outputsLength).toBe(3)
    expect(hex.encode(tx.getOutput(1).script!)).toBe(P2A_SCRIPT_HEX)
    const stripped = tx.toBytes(false).length
    const witnessBytes = raw.length - stripped
    expect(witnessBytes).toBe(WITNESS_BYTES_399)
  })

  it('signs a phone clawback and a recovery claim', () => {
    const built = family()
    const clawAuth = built.clawbackAuth['savings-hardware']
    const claw = buildClawbackPsbt({
      family: built,
      kind: 'savings',
      claimant: 'hardware',
      guardian: 'phone',
      coin: COIN,
      feeSats: 500,
    })
    const clawSigned = signPsbt(
      claw.psbtHex,
      scalarSecret(3),
      tweakPrivateKey(scalarSecret(14), clawAuth),
      tweakPrivateKey(scalarSecret(15), clawAuth),
    )
    expect(clawSigned.raw.length - Transaction.fromRaw(clawSigned.raw, TX_OPTS).toBytes(false).length).toBe(
      WITNESS_BYTES_399,
    )
    const claim = buildClaimPsbt({
      family: built,
      kind: 'savings',
      claimant: 'recovery',
      coin: COIN,
      destAddress: built.daily.address,
      feeSats: 400,
      network: V5_FIXTURE.network,
    })
    const claimed = signPsbt(claim.psbtHex, scalarSecret(5))
    expect(claimed.txid).toMatch(/^[0-9a-f]{64}$/)
    expect(inspectClaimPsbt(claim.psbtHex).sequence).toBe(V5_CSV.recovery)
  })

  it('refuses a fee that cannot leave dust after the funded P2A', () => {
    const built = family()
    expect(() =>
      buildInitiatePsbt({
        family: built,
        kind: 'daily',
        claimant: 'phone',
        coin: { ...COIN, value: 400 },
        feeSats: 100,
      }),
    ).toThrow(/dust/)
  })
})

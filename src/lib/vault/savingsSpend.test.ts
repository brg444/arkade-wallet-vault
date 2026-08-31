import { hex } from '@scure/base'
import { Transaction } from '@scure/btc-signer'
import { beforeEach, describe, expect, it } from 'vitest'
import { pinEnrolledStatus } from './pin'
import {
  buildSavingsPsbt,
  finalizeSavingsPsbt,
  inspectSavingsPsbt,
  psbtFile,
  psbtHexToBase64,
  readPsbtFile,
  requireSameSavingsIntent,
  signSavingsPsbt,
} from './savingsSpend'
import type { VaultStatus } from './types'
import { buildVaultProgramDescriptor, familyFromDescriptor } from './program/descriptor'
import { PROGRAM_FIXTURE, scalarSecret } from './program/fixtures'
import { buildRecoveryKit } from './program/kit'
import { saveLocalKit } from './program/kitStore'
import { spendingPolicyFromLimits, spendingPolicyDigest } from './spendingPolicy'

const PHONE_PRIV = hex.decode('00'.repeat(31) + '03')
const HW_PRIV = hex.decode('00'.repeat(31) + '04')
const BOARDING_DEST = 'tb1p9llcrjjkzr57py6vffwveztm0hn0hezj7wzrq5mat6nh07j37g4qh8jl0l'

function currentAdminPsbt(): string {
  const descriptor = buildVaultProgramDescriptor(PROGRAM_FIXTURE)
  const savings = familyFromDescriptor(descriptor).savings
  const leaf = savings.tapLeafScript?.find((entry) => hex.encode(entry[1].slice(0, -1)) === hex.encode(savings.admin))
  if (!leaf) throw new Error('Savings admin leaf missing')
  const tx = new Transaction({ version: 2, allowUnknownInputs: true, allowUnknownOutputs: true })
  tx.addInput({
    txid: new Uint8Array(32),
    index: 0,
    witnessUtxo: { script: savings.script, amount: 100_000n },
    tapInternalKey: savings.tapInternalKey,
    tapLeafScript: [leaf],
    sequence: 0xffffffff,
  })
  tx.addOutput({ script: savings.script, amount: 98_500n })
  return hex.encode(tx.toPSBT())
}

function statusFromDescriptor(descriptor: ReturnType<typeof buildVaultProgramDescriptor>): VaultStatus {
  const spendingPolicy = spendingPolicyFromLimits({
    txRecipientCapSats: descriptor.policy.recipientCapSats,
    periodAllowanceSats: descriptor.policy.periodAllowanceSats,
    absoluteFeeCapSats: descriptor.policy.absoluteFeeCapSats,
    feerateCapSatPerV: descriptor.policy.feerateCapSatVb,
  })
  return {
    enrolled: true,
    network: descriptor.network,
    clientOrigin: 'https://vault.example',
    rpId: 'vault.example',
    vaultId: descriptor.vaultId,
    templateVersion: descriptor.templateVersion,
    policyVersion: descriptor.policyVersion,
    savingsAddress: descriptor.savings.address,
    savingsScript: descriptor.savings.script,
    periodAllowance: descriptor.policy.periodAllowanceSats,
    periodSpent: 0,
    periodRemaining: descriptor.policy.periodAllowanceSats,
    txCap: descriptor.policy.recipientCapSats,
    absoluteFeeCap: descriptor.policy.absoluteFeeCapSats,
    feerateCapSatVb: descriptor.policy.feerateCapSatVb,
    spendingPolicy,
    spendingPolicyDigest: spendingPolicyDigest(spendingPolicy),
    phoneBip340Pub: descriptor.keys.phoneBip340,
    externalOwnerWalletPub: descriptor.keys.hardware,
    recoveryPub: descriptor.keys.recovery,
    vaultCosignerBasePub: descriptor.keys.vaultCosignerBase,
    arkadeCosignerBasePub: descriptor.keys.arkadeCosignerBase,
    arkadeCosignerOrigin: descriptor.arkadeCosigner.origin,
    arkadeCosignerVersion: descriptor.arkadeCosigner.version,
    vtxoVaultCosignerPub: '02' + '11'.repeat(32),
    vtxoExitDelay: 4608,
    vtxoExitDelayUnit: 'seconds',
    spendingArkAddress: 'tark1spending',
    spendingArkScript: '5120' + '22'.repeat(32),
    vtxoDelegatePub: '02' + '33'.repeat(32),
    vtxoBoardingActive: true,
    vtxoBoardingProgram: 'vault-board-v1',
    vtxoBoardingAddress: BOARDING_DEST,
    vtxoBoardingScript: '5120' + '44'.repeat(32),
    vtxoBoardingExitDelay: 604672,
    vtxoBoardingExitDelayUnit: 'seconds',
  }
}

describe('savings admin PSBT', () => {
  beforeEach(() => localStorage.clear())

  it('phone then hardware can finalize the admin leaf', () => {
    const phoneSigned = signSavingsPsbt(currentAdminPsbt(), PHONE_PRIV)
    const both = signSavingsPsbt(phoneSigned, HW_PRIV)
    const final = finalizeSavingsPsbt(both)
    expect(final.txHex.length).toBeGreaterThan(100)
    expect(final.txid).toMatch(/^[0-9a-f]{64}$/)
  })

  it('exports a .psbt file wallets can share', () => {
    const hexPsbt = currentAdminPsbt()
    const file = psbtFile(hexPsbt)
    expect(file.name).toBe('arkade-savings.psbt')
    expect(file.size).toBeGreaterThan(20)
    expect(psbtHexToBase64(hexPsbt).length).toBeGreaterThan(20)
  })

  it('reads a binary .psbt file back into the canonical hex form', async () => {
    const hexPsbt = currentAdminPsbt()
    await expect(readPsbtFile(psbtFile(hexPsbt))).resolves.toBe(hexPsbt)
    await expect(readPsbtFile(new File([], 'empty.psbt'))).rejects.toThrow(/smaller than 1 MB/)
  })

  it.each([true, false])('spends Savings with recovery=%s', (withRecovery) => {
    const descriptor = buildVaultProgramDescriptor({
      ...PROGRAM_FIXTURE,
      recoveryPub: withRecovery ? PROGRAM_FIXTURE.recoveryPub : undefined,
      arkadeCosigner: {
        origin: 'https://emulator.mutinynet.arkade.sh',
        version: 'v0.0.7-rc.1',
      },
    })
    const status = statusFromDescriptor(descriptor)
    saveLocalKit(buildRecoveryKit(descriptor))
    pinEnrolledStatus(status)
    const unsigned = buildSavingsPsbt({
      status,
      phonePub: descriptor.keys.phoneBip340,
      destAddress: BOARDING_DEST,
      amountSats: 50_000,
      feeSats: 1_500,
      coins: [{ txid: '11'.repeat(32), vout: 0, value: 100_000, confirmedHeight: 1 }],
      leaf: 'admin',
    })
    const phoneSigned = signSavingsPsbt(unsigned, scalarSecret(3))
    const hardwareSigned = signSavingsPsbt(phoneSigned, scalarSecret(4))
    expect(finalizeSavingsPsbt(hardwareSigned).txid).toMatch(/^[0-9a-f]{64}$/)
  })

  it('combines fragmented Savings and requires hardware to sign every canonical input', () => {
    const descriptor = buildVaultProgramDescriptor({
      ...PROGRAM_FIXTURE,
      arkadeCosigner: {
        origin: 'https://emulator.mutinynet.arkade.sh',
        version: 'v0.0.7-rc.1',
      },
    })
    const status = statusFromDescriptor(descriptor)
    saveLocalKit(buildRecoveryKit(descriptor))
    pinEnrolledStatus(status)
    const unsigned = buildSavingsPsbt({
      status,
      phonePub: descriptor.keys.phoneBip340,
      destAddress: BOARDING_DEST,
      amountSats: 50_000,
      feeSats: 1_500,
      coins: [
        { txid: '22'.repeat(32), vout: 1, value: 26_000, confirmedHeight: 1 },
        { txid: '11'.repeat(32), vout: 0, value: 30_000, confirmedHeight: 1 },
      ],
      leaf: 'admin',
    })
    const phoneSigned = signSavingsPsbt(unsigned, scalarSecret(3))
    expect(() => requireSameSavingsIntent(phoneSigned, phoneSigned, BOARDING_DEST, 50_000, descriptor.network)).toThrow(
      /hardware did not sign every/,
    )

    const hardwareSigned = signSavingsPsbt(phoneSigned, scalarSecret(4))
    requireSameSavingsIntent(phoneSigned, hardwareSigned, BOARDING_DEST, 50_000, descriptor.network)
    const inspected = inspectSavingsPsbt(hardwareSigned)
    expect(inspected.inputs.map((input) => `${input.txid}:${input.vout}`)).toEqual([
      `${'11'.repeat(32)}:0`,
      `${'22'.repeat(32)}:1`,
    ])
    expect(inspected.outputs.map((output) => output.amount)).toEqual([50_000, 4_500])
    expect(finalizeSavingsPsbt(hardwareSigned).txid).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts a hardware signature only for the exact persisted Savings transaction', () => {
    const descriptor = buildVaultProgramDescriptor(PROGRAM_FIXTURE)
    const status = statusFromDescriptor(descriptor)
    saveLocalKit(buildRecoveryKit(descriptor))
    pinEnrolledStatus(status)
    const build = (amountSats: number) =>
      buildSavingsPsbt({
        status,
        phonePub: descriptor.keys.phoneBip340,
        destAddress: BOARDING_DEST,
        amountSats,
        feeSats: 1_500,
        coins: [{ txid: '11'.repeat(32), vout: 0, value: 100_000, confirmedHeight: 1 }],
        leaf: 'admin',
      })

    const firstPhone = signSavingsPsbt(build(50_000), scalarSecret(3))
    const firstHardware = signSavingsPsbt(firstPhone, scalarSecret(4))
    const identicalRetry = signSavingsPsbt(build(50_000), scalarSecret(3))
    const differentAmount = signSavingsPsbt(build(40_000), scalarSecret(3))

    requireSameSavingsIntent(identicalRetry, firstHardware, BOARDING_DEST, 50_000, descriptor.network)
    expect(() =>
      requireSameSavingsIntent(differentAmount, firstHardware, BOARDING_DEST, 40_000, descriptor.network),
    ).toThrow(/changed the unsigned Savings transaction/)
  })
})

import { describe, expect, it } from 'vitest'
import type { VaultStatus } from '../types'
import { xOnly } from '../setupPlan'
import { buildVaultProgramDescriptor } from './descriptor'
import { PROGRAM_FIXTURE } from './fixtures'
import { buildRecoveryKit } from './kit'
import { buildMapBackup, evenYCompressed, kitFromFacts, parseMapBackup } from './kitBackup'

function statusFromDescriptor(descriptor: ReturnType<typeof buildVaultProgramDescriptor>): VaultStatus {
  return {
    enrolled: true,
    network: descriptor.network,
    clientOrigin: 'https://vault.example',
    rpId: 'vault.example',
    vaultId: descriptor.vaultId,
    templateVersion: descriptor.templateVersion,
    policyVersion: descriptor.policyVersion,
    operationalCsvBlocks: descriptor.csv.phone,
    savingsCsvBlocks: descriptor.csv.hardware,
    externalOwnerWalletPub: descriptor.keys.hardware,
    vaultCosignerBasePub: descriptor.keys.vaultCosignerBase,
    arkadeCosignerBasePub: descriptor.keys.arkadeCosignerBase,
    arkadeCosignerOrigin: descriptor.arkadeCosigner.origin,
    arkadeCosignerVersion: descriptor.arkadeCosigner.version,
    operationalAddress: descriptor.daily.address,
    savingsAddress: descriptor.savings.address,
    savingsExcludesRoutineCosigners: true,
    periodAllowance: descriptor.policy.periodAllowanceSats,
    periodSpent: 0,
    periodRemaining: descriptor.policy.periodAllowanceSats,
    txCap: descriptor.policy.recipientCapSats,
    absoluteFeeCap: descriptor.policy.absoluteFeeCapSats,
    feerateCapSatVb: descriptor.policy.feerateCapSatVb,
    phoneRoutineBip340Pub: descriptor.keys.phoneRoutineBip340,
    phoneDirectP256: descriptor.keys.phoneDirectP256,
    tweakedVaultCosignerXOnly: xOnly(descriptor.tweaks.routine.vault),
    tweakedArkadeCosignerXOnly: xOnly(descriptor.tweaks.routine.arkade),
    recoveryPub: descriptor.keys.recovery,
  }
}

function descriptor(recovery = true) {
  return buildVaultProgramDescriptor({
    ...PROGRAM_FIXTURE,
    recoveryPub: recovery ? PROGRAM_FIXTURE.recoveryPub : undefined,
    routineVault: evenYCompressed(xOnly(PROGRAM_FIXTURE.routineVault)),
    routineArkade: evenYCompressed(xOnly(PROGRAM_FIXTURE.routineArkade)),
  })
}

describe('vault map backup', () => {
  it('stores only the public committed kit', () => {
    const kit = buildRecoveryKit(descriptor())
    const backup = buildMapBackup(kit, '2026-08-18T00:00:00.000Z')
    expect(backup.name).toBe('arkade-vault-map')
    expect(backup.kit).not.toHaveProperty('secret')
    expect(JSON.stringify(Object.keys(backup))).not.toMatch(/secret|mnemonic|seed/)
    expect(parseMapBackup(backup).kit.descriptorHash).toBe(kit.descriptorHash)
  })

  it('rebuilds only from complete signer-pinned status facts', () => {
    const committed = descriptor()
    const status = statusFromDescriptor(committed)
    expect(kitFromFacts({ status })?.descriptorHash).toBe(buildRecoveryKit(committed).descriptorHash)
    expect(kitFromFacts({ status: { ...status, arkadeCosignerOrigin: undefined } })).toBeNull()
    expect(kitFromFacts({ status: { ...status, savingsAddress: 'tb1pstale' } })).toBeNull()
  })

  it('rebuilds a no-recovery kit for Savings', () => {
    const committed = descriptor(false)
    const rebuilt = kitFromFacts({ status: statusFromDescriptor(committed) })
    expect(rebuilt?.descriptor.keys.recovery).toBeUndefined()
    expect(rebuilt?.descriptor.savings.address).toBe(committed.savings.address)
  })

  it('lifts an x-only tweak to even-Y compressed', () => {
    expect(evenYCompressed(xOnly(PROGRAM_FIXTURE.routineVault))).toMatch(/^02[0-9a-f]{64}$/)
  })
})

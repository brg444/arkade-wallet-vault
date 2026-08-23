import { describe, expect, it } from 'vitest'
import type { VaultStatus } from '../types'
import { buildVaultProgramDescriptor } from './descriptor'
import { PROGRAM_FIXTURE } from './fixtures'
import { buildRecoveryKit } from './kit'
import { buildMapBackup, kitFromFacts, parseMapBackup } from './kitBackup'

function descriptor(recovery = true) {
  return buildVaultProgramDescriptor({
    ...PROGRAM_FIXTURE,
    recoveryPub: recovery ? PROGRAM_FIXTURE.recoveryPub : undefined,
  })
}

function statusFromDescriptor(committed: ReturnType<typeof descriptor>): VaultStatus {
  return {
    enrolled: true,
    network: committed.network,
    clientOrigin: 'https://vault.example',
    rpId: 'vault.example',
    vaultId: committed.vaultId,
    templateVersion: committed.templateVersion,
    policyVersion: committed.policyVersion,
    externalOwnerWalletPub: committed.keys.hardware,
    vaultCosignerBasePub: committed.keys.vaultCosignerBase,
    arkadeCosignerBasePub: committed.keys.arkadeCosignerBase,
    arkadeCosignerOrigin: committed.arkadeCosigner.origin,
    arkadeCosignerVersion: committed.arkadeCosigner.version,
    savingsAddress: committed.savings.address,
    savingsScript: committed.savings.script,
    periodAllowance: committed.policy.periodAllowanceSats,
    periodSpent: 0,
    periodRemaining: committed.policy.periodAllowanceSats,
    txCap: committed.policy.recipientCapSats,
    absoluteFeeCap: committed.policy.absoluteFeeCapSats,
    feerateCapSatVb: committed.policy.feerateCapSatVb,
    phoneBip340Pub: committed.keys.phoneBip340,
    phoneDirectP256: committed.keys.phoneDirectP256,
    recoveryPub: committed.keys.recovery,
  }
}

describe('Savings map backup', () => {
  it('stores only the public committed Recovery Kit', () => {
    const kit = buildRecoveryKit(descriptor())
    const backup = buildMapBackup(kit, '2026-08-18T00:00:00.000Z')
    expect(backup.name).toBe('arkade-vault-map')
    expect(backup.version).toBe(2)
    expect(JSON.stringify(backup)).not.toMatch(/mnemonic|privateKey|secret/)
    expect(parseMapBackup(backup).kit.descriptorHash).toBe(kit.descriptorHash)
  })

  it('rebuilds only from complete signer-pinned status facts', () => {
    const committed = descriptor()
    const status = statusFromDescriptor(committed)
    expect(kitFromFacts({ status })?.descriptorHash).toBe(buildRecoveryKit(committed).descriptorHash)
    expect(kitFromFacts({ status: { ...status, arkadeCosignerOrigin: undefined } })).toBeNull()
    expect(kitFromFacts({ status: { ...status, savingsAddress: 'tb1pstale' } })).toBeNull()
    expect(kitFromFacts({ status: { ...status, savingsScript: '5120' + '00'.repeat(32) } })).toBeNull()
  })

  it('persists a usable no-recovery Savings kit', () => {
    const committed = descriptor(false)
    const rebuilt = kitFromFacts({ status: statusFromDescriptor(committed) })
    expect(rebuilt?.descriptor.keys.recovery).toBeUndefined()
    expect(rebuilt?.descriptor.savings.address).toBe(committed.savings.address)
  })
})

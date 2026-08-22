import { describe, expect, it } from 'vitest'
import type { VaultStatus } from '../types'
import { STAGED_TEMPLATE } from './constants'
import { buildVaultProgramDescriptor } from './descriptor'
import { PROGRAM_FIXTURE } from './fixtures'
import { buildRecoveryKit } from './kit'
import { kitMatchesLiveVault, selectLiveKit, watcherEnabledForTemplate } from './liveKit'

function statusForProgram(): VaultStatus {
  const descriptor = buildVaultProgramDescriptor(PROGRAM_FIXTURE)
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
    externalOwnerWalletPub: descriptor.keys.hardware,
    recoveryPub: descriptor.keys.recovery,
    vaultCosignerBasePub: descriptor.keys.vaultCosignerBase,
    arkadeCosignerBasePub: descriptor.keys.arkadeCosignerBase,
    arkadeCosignerOrigin: descriptor.arkadeCosigner.origin,
    arkadeCosignerVersion: descriptor.arkadeCosigner.version,
  }
}

describe('live kit and watcher policy', () => {
  it('starts only for the current program', () => {
    expect(watcherEnabledForTemplate(STAGED_TEMPLATE)).toBe(true)
    expect(watcherEnabledForTemplate('phone-hww-recovery-staged-v5')).toBe(false)
    expect(watcherEnabledForTemplate('')).toBe(false)
  })

  it('binds the kit to the complete live identity', () => {
    const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE))
    const status = statusForProgram()
    expect(kitMatchesLiveVault(kit, status)).toBe(true)
    expect(selectLiveKit({ status, stored: kit })).toBe(kit)
    expect(kitMatchesLiveVault(kit, { ...status, vaultId: 'another-vault' })).toBe(false)
    expect(kitMatchesLiveVault(kit, { ...status, savingsAddress: 'tb1pstale' })).toBe(false)
    expect(kitMatchesLiveVault(kit, { ...status, arkadeCosignerVersion: 'stale' })).toBe(false)
  })

  it('does not let a pre-enrollment kit drive recovery', () => {
    const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE))
    const status = { ...statusForProgram(), enrolled: false }
    expect(selectLiveKit({ status, stored: kit })).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import type { VaultStatus } from '../types'
import { SAVINGS_TEMPLATE } from './constants'
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
    protectionTier: descriptor.protectionTier,
    savingsAddress: descriptor.savings.address,
    savingsScript: descriptor.savings.script,
    periodAllowance: descriptor.policy.periodAllowanceSats,
    periodSpent: 0,
    periodRemaining: descriptor.policy.periodAllowanceSats,
    txCap: descriptor.policy.recipientCapSats,
    absoluteFeeCap: descriptor.policy.absoluteFeeCapSats,
    feerateCapSatVb: descriptor.policy.feerateCapSatVb,
    phoneBip340Pub: descriptor.keys.phoneBip340,
    phoneDirectP256: descriptor.keys.phoneDirectP256,
    externalOwnerWalletPub: descriptor.keys.hardware,
    recoveryPub: descriptor.keys.recovery,
    vaultCosignerBasePub: descriptor.keys.vaultCosignerBase,
    arkadeCosignerBasePub: descriptor.keys.arkadeCosignerBase,
    arkadeCosignerOrigin: descriptor.arkadeCosigner.origin,
    arkadeCosignerVersion: descriptor.arkadeCosigner.version,
  }
}

describe('live Savings kit policy', () => {
  it('enables the watcher only for this release', () => {
    expect(watcherEnabledForTemplate(SAVINGS_TEMPLATE)).toBe(true)
    expect(watcherEnabledForTemplate('phone-hww-recovery-staged-v6')).toBe(false)
    expect(watcherEnabledForTemplate('')).toBe(false)
  })

  it('binds selection to the complete live Savings identity', () => {
    const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE))
    const status = statusForProgram()
    expect(kitMatchesLiveVault(kit, status)).toBe(true)
    expect(selectLiveKit({ status, stored: kit })).toBe(kit)
    expect(kitMatchesLiveVault(kit, { ...status, vaultId: 'another-vault' })).toBe(false)
    expect(kitMatchesLiveVault(kit, { ...status, savingsAddress: 'tb1pstale' })).toBe(false)
    expect(kitMatchesLiveVault(kit, { ...status, savingsScript: '5120' + '00'.repeat(32) })).toBe(false)
    expect(kitMatchesLiveVault(kit, { ...status, arkadeCosignerVersion: 'preview' })).toBe(false)
    expect(kitMatchesLiveVault(kit, { ...status, protectionTier: 'standard' })).toBe(false)
    expect(
      kitMatchesLiveVault(kit, {
        ...status,
        externalOwnerWalletPub: `${status.externalOwnerWalletPub?.startsWith('02') ? '03' : '02'}${status.externalOwnerWalletPub?.slice(2)}`,
      }),
    ).toBe(true)
  })

  it('binds recovery metadata to an opaque signer identity without changing its address', () => {
    const original = buildVaultProgramDescriptor(PROGRAM_FIXTURE)
    const descriptor = buildVaultProgramDescriptor({
      ...PROGRAM_FIXTURE,
      arkadeCosigner: { ...PROGRAM_FIXTURE.arkadeCosigner, origin: 'urn:vaulted:mainnet-signer:v1' },
    })
    const kit = buildRecoveryKit(descriptor)
    expect(descriptor.savings).toEqual(original.savings)
    expect(
      kitMatchesLiveVault(kit, { ...statusForProgram(), arkadeCosignerOrigin: descriptor.arkadeCosigner.origin }),
    ).toBe(true)
    expect(kitMatchesLiveVault(kit, statusForProgram())).toBe(false)
    expect(JSON.stringify(kit)).not.toContain(PROGRAM_FIXTURE.arkadeCosigner.origin)
  })

  it('does not let pre-enrollment state drive recovery', () => {
    const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE))
    expect(selectLiveKit({ status: { ...statusForProgram(), enrolled: false }, stored: kit })).toBeNull()
  })
})

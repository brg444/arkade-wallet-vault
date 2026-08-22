import { STAGED_TEMPLATE } from './constants'
import type { VaultStatus } from '../types'
import type { RecoveryKit } from './kit'

export function watcherEnabledForTemplate(templateVersion?: string): boolean {
  return String(templateVersion || '') === STAGED_TEMPLATE
}

export function kitMatchesLiveVault(kit: RecoveryKit, status: VaultStatus): boolean {
  const descriptor = kit.descriptor
  if (!status.enrolled || status.templateVersion !== STAGED_TEMPLATE) return false
  return (
    descriptor.vaultId === status.vaultId &&
    descriptor.templateVersion === status.templateVersion &&
    descriptor.daily.address === status.operationalAddress &&
    descriptor.savings.address === status.savingsAddress &&
    descriptor.keys.phoneRoutineBip340 === status.phoneRoutineBip340Pub &&
    descriptor.keys.hardware === status.externalOwnerWalletPub &&
    descriptor.keys.recovery === status.recoveryPub &&
    descriptor.keys.vaultCosignerBase === status.vaultCosignerBasePub &&
    descriptor.keys.arkadeCosignerBase === status.arkadeCosignerBasePub &&
    descriptor.arkadeCosigner.origin === status.arkadeCosignerOrigin &&
    descriptor.arkadeCosigner.version === status.arkadeCosignerVersion
  )
}

export function selectLiveKit(input: { status: VaultStatus; stored: RecoveryKit | null }): RecoveryKit | null {
  if (!watcherEnabledForTemplate(input.status.templateVersion)) return null
  if (!input.stored) return null
  if (!kitMatchesLiveVault(input.stored, input.status)) return null
  return input.stored
}

export function assertLiveKit(kit: RecoveryKit, status: VaultStatus): RecoveryKit {
  if (!kitMatchesLiveVault(kit, status)) {
    throw new Error('Recovery Kit does not match this vault')
  }
  return kit
}

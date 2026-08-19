import { isStagedTemplate } from './constants'
import type { V5PublicDescriptor } from './descriptor'
import type { RecoveryKit } from './kit'
import { isPreviewKitOrigin } from './preview'

export function watcherEnabledForTemplate(templateVersion?: string): boolean {
  return isStagedTemplate(String(templateVersion || ''))
}

export function isPreviewDescriptor(descriptor: V5PublicDescriptor): boolean {
  return isPreviewKitOrigin(descriptor.arkadeCosigner.origin) || isPreviewKitOrigin(descriptor.arkadeCosigner.version)
}

export function kitMatchesLiveVault(kit: RecoveryKit, vaultId: string, templateVersion: string): boolean {
  const id = vaultId.trim()
  const template = templateVersion.trim()
  if (!id || !template) return false
  if (isPreviewDescriptor(kit.descriptor)) return false
  return kit.descriptor.vaultId === id && kit.descriptor.templateVersion === template
}

export function selectLiveKit(input: {
  vaultId: string
  templateVersion: string
  stored: RecoveryKit | null
}): RecoveryKit | null {
  if (!watcherEnabledForTemplate(input.templateVersion)) return null
  if (!input.stored) return null
  if (!kitMatchesLiveVault(input.stored, input.vaultId, input.templateVersion)) return null
  return input.stored
}

export function assertLiveKit(kit: RecoveryKit, vaultId: string, templateVersion: string): RecoveryKit {
  if (isPreviewDescriptor(kit.descriptor)) {
    throw new Error('preview map cannot replace a live Recovery Kit')
  }
  if (!kitMatchesLiveVault(kit, vaultId, templateVersion)) {
    throw new Error('Recovery Kit does not match this vault')
  }
  return kit
}

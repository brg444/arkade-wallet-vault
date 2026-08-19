import type { VaultNetwork } from '../constants'
import { buildV5Descriptor, type V5DescriptorInput, type V5PublicDescriptor } from './descriptor'
import { V5_FIXTURE } from './fixtures'

/** Local/demo family from setup keys + fixture cosigner bases. Not a live deposit. */
export function previewV5Input(input: {
  vaultId?: string
  network?: VaultNetwork
  hardwarePub: string
  recoveryPub: string
  phonePub?: string
  phoneDirectP256?: string
}): V5DescriptorInput {
  return {
    vaultId: input.vaultId || 'preview-vault-v5',
    network: input.network || 'mutinynet',
    phonePub: input.phonePub || V5_FIXTURE.phonePub,
    hardwarePub: input.hardwarePub,
    recoveryPub: input.recoveryPub,
    phoneDirectP256: input.phoneDirectP256 || V5_FIXTURE.phoneDirectP256,
    vaultCosignerBase: V5_FIXTURE.vaultCosignerBase,
    arkadeCosignerBase: V5_FIXTURE.arkadeCosignerBase,
    routineVault: V5_FIXTURE.routineVault,
    routineArkade: V5_FIXTURE.routineArkade,
    arkadeCosigner: {
      origin: 'preview',
      version: 'v5-preview',
    },
    templateVersion: 'phone-hww-recovery-staged-v5',
  }
}

export function previewV5Descriptor(input: Parameters<typeof previewV5Input>[0]): V5PublicDescriptor {
  return buildV5Descriptor(previewV5Input(input))
}

export function isPreviewKitOrigin(origin: string): boolean {
  return origin === 'preview' || origin === 'v5-preview'
}

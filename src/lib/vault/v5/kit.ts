import { FAMILY_KEYS, V5_CSV, V5_SCHEMA, V5_TEMPLATE } from './constants'
import { hashV5Descriptor, validateV5Descriptor, type V5PublicDescriptor } from './descriptor'

export const RECOVERY_KIT_NAME = 'arkade-recovery-kit'
export const RECOVERY_KIT_VERSION = 1

export interface RecoveryKit {
  name: typeof RECOVERY_KIT_NAME
  version: typeof RECOVERY_KIT_VERSION
  descriptor: V5PublicDescriptor
  descriptorHash: string
}

export interface RecoveryKitReport {
  vaultId: string
  hash: string
  trees: { role: string; address: string; delay?: number; guardians?: readonly string[] }[]
  warnings: string[]
}

export function buildRecoveryKit(descriptor: V5PublicDescriptor): RecoveryKit {
  const d = validateV5Descriptor(descriptor)
  return {
    name: RECOVERY_KIT_NAME,
    version: RECOVERY_KIT_VERSION,
    descriptor: d,
    descriptorHash: hashV5Descriptor(d),
  }
}

export function parseRecoveryKit(raw: unknown): RecoveryKit {
  const kit = raw as RecoveryKit
  if (!kit || kit.name !== RECOVERY_KIT_NAME) throw new Error('not a Recovery Kit')
  if (kit.version !== RECOVERY_KIT_VERSION) throw new Error('unsupported Recovery Kit version')
  const built = buildRecoveryKit(kit.descriptor)
  if (kit.descriptorHash && kit.descriptorHash !== built.descriptorHash) {
    throw new Error('Recovery Kit hash does not match the rebuilt descriptor')
  }
  return built
}

export function inspectRecoveryKit(kit: RecoveryKit): RecoveryKitReport {
  const parsed = parseRecoveryKit(kit)
  const d = parsed.descriptor
  const trees = [
    { role: 'daily', address: d.daily.address },
    { role: 'savings', address: d.savings.address },
    ...FAMILY_KEYS.map((key) => ({
      role: `pending-${key}`,
      address: d.pending[key].address,
      delay: d.pending[key].delay,
    })),
    ...FAMILY_KEYS.map((key) => ({
      role: `quarantine-${key}`,
      address: d.quarantine[key].address,
      guardians: d.quarantine[key].guardians,
    })),
  ]
  return {
    vaultId: d.vaultId,
    hash: parsed.descriptorHash,
    trees,
    warnings: [
      'Recovery cannot exit a Normal UTXO if both cosigners are gone.',
      'A mature Pending recovery claim can pay any destination.',
      `Demo clocks: hardware ${V5_CSV.hardware}, phone ${V5_CSV.phone}, recovery ${V5_CSV.recovery} blocks.`,
    ],
  }
}

export function assertKitTemplate(d: V5PublicDescriptor) {
  if (d.schema !== V5_SCHEMA || d.templateVersion !== V5_TEMPLATE) {
    throw new Error('Recovery Kit is v5 only')
  }
}

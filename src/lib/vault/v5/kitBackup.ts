import { vaultGet, vaultPost } from '../api'
import type { EnrollmentSecrets } from '../tenantEnrollment'
import type { VaultStatus } from '../types'
import { requireLowerHex } from '../hex'
import { xOnly } from '../setupPlan'
import { buildV5Descriptor } from './descriptor'
import { buildRecoveryKit, parseRecoveryKit, type RecoveryKit } from './kit'
import { previewV5Descriptor } from './preview'

export const MAP_BACKUP_NAME = 'arkade-vault-map'
export const MAP_BACKUP_VERSION = 1

export interface MapBackup {
  name: typeof MAP_BACKUP_NAME
  version: typeof MAP_BACKUP_VERSION
  kit: RecoveryKit
  backedUpAt: string
}

export function evenYCompressed(xonly: string): string {
  const hex = requireLowerHex(xonly, 'x-only', 32)
  return `02${hex}`
}

export function parseMapBackup(raw: unknown): MapBackup {
  const rec = raw as MapBackup
  if (!rec || rec.name !== MAP_BACKUP_NAME) throw new Error('not a vault map backup')
  if (rec.version !== MAP_BACKUP_VERSION) throw new Error('unsupported map backup version')
  return {
    name: MAP_BACKUP_NAME,
    version: MAP_BACKUP_VERSION,
    kit: parseRecoveryKit(rec.kit),
    backedUpAt: String(rec.backedUpAt || ''),
  }
}

export function buildMapBackup(kit: RecoveryKit, now = new Date().toISOString()): MapBackup {
  return {
    name: MAP_BACKUP_NAME,
    version: MAP_BACKUP_VERSION,
    kit: parseRecoveryKit(kit),
    backedUpAt: now,
  }
}

export function kitFromFacts(input: {
  enrollment?: Pick<EnrollmentSecrets, 'phoneRoutineBip340Pub' | 'phoneDirectP256' | 'vaultId'> | null
  status?: VaultStatus | null
  hardwarePub?: string
  recoveryPub?: string
}): RecoveryKit | null {
  const recoveryPub = input.recoveryPub || input.status?.recoveryPub || ''
  const hardwarePub = input.hardwarePub || input.status?.externalOwnerWalletPub || ''
  const phonePub = input.enrollment?.phoneRoutineBip340Pub || input.status?.phoneRoutineBip340Pub || ''
  const phoneDirectP256 = input.enrollment?.phoneDirectP256 || input.status?.phoneDirectP256 || ''
  if (!recoveryPub || !hardwarePub) return null

  const vaultId = input.status?.vaultId || input.enrollment?.vaultId || ''
  const liveBases = Boolean(input.status?.vaultCosignerBasePub && input.status?.arkadeCosignerBasePub)
  if (liveBases && phonePub && phoneDirectP256 && vaultId) {
    try {
      const descriptor = buildV5Descriptor({
        vaultId,
        network: input.status?.network === 'regtest' ? 'regtest' : 'mutinynet',
        phonePub,
        hardwarePub,
        recoveryPub,
        phoneDirectP256,
        vaultCosignerBase: input.status!.vaultCosignerBasePub!,
        arkadeCosignerBase: input.status!.arkadeCosignerBasePub!,
        routineVault: evenYCompressed(
          xOnly(input.status!.tweakedVaultCosignerXOnly || input.status!.vaultCosignerBasePub!),
        ),
        routineArkade: evenYCompressed(
          xOnly(input.status!.tweakedArkadeCosignerXOnly || input.status!.arkadeCosignerBasePub!),
        ),
        arkadeCosigner: {
          origin: input.status!.arkadeCosignerOrigin || (typeof location !== 'undefined' ? location.origin : 'preview'),
          version: input.status!.arkadeCosignerVersion || 'v5',
        },
      })
      if (input.status?.operationalAddress && descriptor.daily.address !== input.status.operationalAddress) {
        throw new Error('rebuilt map does not match this vault')
      }
      return buildRecoveryKit(descriptor)
    } catch {
      return null
    }
  }

  try {
    return buildRecoveryKit(
      previewV5Descriptor({
        vaultId: vaultId || undefined,
        network: input.status?.network === 'regtest' ? 'regtest' : 'mutinynet',
        hardwarePub,
        recoveryPub,
        phonePub: phonePub || undefined,
        phoneDirectP256: phoneDirectP256 || undefined,
      }),
    )
  } catch {
    return null
  }
}

export async function pushMapBackup(vaultId: string, kit: RecoveryKit): Promise<boolean> {
  const id = vaultId.trim()
  if (!id) throw new Error('vault id required')
  const backup = buildMapBackup(kit)
  try {
    await vaultPost('/v1/kit', { vaultId: id, ...backup })
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/404|not found|cannot store|not running|unknown/i.test(msg)) return false
    throw err
  }
}

export async function pullMapBackup(vaultId: string): Promise<RecoveryKit | null> {
  const id = vaultId.trim()
  if (!id) throw new Error('vault id required')
  try {
    const raw = await vaultGet<unknown>(`/v1/kit?vault=${encodeURIComponent(id)}`)
    return parseMapBackup(raw).kit
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/404|not found|cannot store|not running|unknown/i.test(msg)) return null
    throw err
  }
}

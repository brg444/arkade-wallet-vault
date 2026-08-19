import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { vaultGet, vaultPost } from '../api'
import { bytesToHex, hexToBytes, requireLowerHex } from '../hex'
import { xOnly } from '../setupPlan'
import type { EnrollmentSecrets } from '../tenantEnrollment'
import type { VaultStatus } from '../types'
import { buildV5Descriptor } from './descriptor'
import { buildRecoveryKit, parseRecoveryKit, type RecoveryKit } from './kit'
import { previewV5Descriptor } from './preview'

const WRAP_INFO = new TextEncoder().encode('arkade-vault/map-wrap/v1')

export const MAP_BACKUP_NAME = 'arkade-vault-map'
export const MAP_BACKUP_VERSION = 1

export interface MapBackup {
  name: typeof MAP_BACKUP_NAME
  version: typeof MAP_BACKUP_VERSION
  kit: RecoveryKit
  wrap?: HardwareMapWrap
  backedUpAt: string
}

export const HARDWARE_WRAP_NAME = 'arkade-vault-map-wrap'
export const HARDWARE_WRAP_VERSION = 1

export interface HardwareMapWrap {
  name: typeof HARDWARE_WRAP_NAME
  version: typeof HARDWARE_WRAP_VERSION
  vaultId: string
  kitHash: string
  hardwareXOnly: string
  ephemPub: string
  nonce: string
  ciphertext: string
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
    wrap: rec.wrap ? parseHardwareMapWrap(rec.wrap) : undefined,
    backedUpAt: String(rec.backedUpAt || ''),
  }
}

export function buildMapBackup(kit: RecoveryKit, now = new Date().toISOString(), wrap?: HardwareMapWrap): MapBackup {
  return {
    name: MAP_BACKUP_NAME,
    version: MAP_BACKUP_VERSION,
    kit: parseRecoveryKit(kit),
    ...(wrap ? { wrap: parseHardwareMapWrap(wrap) } : {}),
    backedUpAt: now,
  }
}

export function parseHardwareMapWrap(raw: unknown): HardwareMapWrap {
  const rec = raw as HardwareMapWrap
  if (!rec || rec.name !== HARDWARE_WRAP_NAME) throw new Error('not a hardware map wrap')
  if (rec.version !== HARDWARE_WRAP_VERSION) throw new Error('unsupported hardware map wrap')
  return {
    name: HARDWARE_WRAP_NAME,
    version: HARDWARE_WRAP_VERSION,
    vaultId: String(rec.vaultId || '').trim(),
    kitHash: requireLowerHex(rec.kitHash, 'kitHash', 32),
    hardwareXOnly: requireLowerHex(rec.hardwareXOnly, 'hardwareXOnly', 32),
    ephemPub: requireLowerHex(rec.ephemPub, 'ephemPub', 33),
    nonce: requireLowerHex(rec.nonce, 'nonce', 12),
    ciphertext: requireLowerHex(rec.ciphertext, 'ciphertext'),
  }
}

async function aesGcmKey(shared: Uint8Array): Promise<CryptoKey> {
  const material = sha256(Uint8Array.from([...WRAP_INFO, ...shared]))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function wrapMapForHardware(kit: RecoveryKit, hardwarePub: string): Promise<HardwareMapWrap> {
  const parsed = parseRecoveryKit(kit)
  const ephem = secp256k1.utils.randomSecretKey()
  try {
    const ephemPub = secp256k1.getPublicKey(ephem, true)
    const shared = secp256k1.getSharedSecret(ephem, hexToBytes(hardwarePub), true)
    const key = await aesGcmKey(shared)
    const nonce = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(JSON.stringify(parsed))
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext))
    return {
      name: HARDWARE_WRAP_NAME,
      version: HARDWARE_WRAP_VERSION,
      vaultId: parsed.descriptor.vaultId,
      kitHash: parsed.descriptorHash,
      hardwareXOnly: xOnly(hardwarePub),
      ephemPub: bytesToHex(ephemPub),
      nonce: bytesToHex(nonce),
      ciphertext: bytesToHex(sealed),
    }
  } finally {
    ephem.fill(0)
  }
}

export async function unwrapMapWithHardware(wrap: HardwareMapWrap, hardwareSecret: Uint8Array): Promise<RecoveryKit> {
  const parsed = parseHardwareMapWrap(wrap)
  const pub = secp256k1.getPublicKey(hardwareSecret, true)
  if (xOnly(bytesToHex(pub)) !== parsed.hardwareXOnly) throw new Error('hardware key does not match this wrap')
  const shared = secp256k1.getSharedSecret(hardwareSecret, hexToBytes(parsed.ephemPub), true)
  const key = await aesGcmKey(shared)
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(parsed.nonce) },
    key,
    hexToBytes(parsed.ciphertext),
  )
  const kit = parseRecoveryKit(JSON.parse(new TextDecoder().decode(opened)))
  if (kit.descriptorHash !== parsed.kitHash) throw new Error('unwrapped map does not match this wrap')
  return kit
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

export async function pushMapBackup(vaultId: string, kit: RecoveryKit, wrap?: HardwareMapWrap): Promise<boolean> {
  const id = vaultId.trim()
  if (!id) throw new Error('vault id required')
  const backup = buildMapBackup(kit, undefined, wrap)
  try {
    const { beginPasskeySession } = await import('../../signIn')
    const { fetchVaultStatus } = await import('../status')
    const status = await fetchVaultStatus(undefined, id)
    const session = await beginPasskeySession('map-write', status)
    await vaultPost('/v1/map', {
      vaultId: id,
      ...session.assertion,
      payload: backup,
    })
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/404|not found|cannot store|not running|unknown|passkey/i.test(msg)) return false
    throw err
  }
}

export async function pullMapBackup(vaultId: string): Promise<{ kit: RecoveryKit; wrap?: HardwareMapWrap } | null> {
  const id = vaultId.trim()
  if (!id) throw new Error('vault id required')
  try {
    const raw = await vaultGet<unknown>(`/v1/map?vault=${encodeURIComponent(id)}`)
    const backup = parseMapBackup(raw)
    return { kit: backup.kit, wrap: backup.wrap }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/404|not found|cannot store|not running|unknown/i.test(msg)) {
      try {
        const legacy = await vaultGet<unknown>(`/v1/kit?vault=${encodeURIComponent(id)}`)
        const backup = parseMapBackup(legacy)
        return { kit: backup.kit, wrap: backup.wrap }
      } catch {
        return null
      }
    }
    throw err
  }
}

import { PROGRAM_SCHEMA } from './constants'
import { hashVaultProgramDescriptor, validateVaultProgramDescriptor, type VaultProgramDescriptor } from './descriptor'
import { bytesToHex, encodeUtf8 } from '../hex'
import { sha256 } from '@noble/hashes/sha2.js'
import { requireVaultBoardV2Descriptor } from '../vtxo/boardV2'
import type { VaultBoardV2Descriptor } from '../types'

const BOARD_V2_ENROLLMENT_SCHEMA = 'arkade-vault/enrollment-with-board-v2'

export interface VaultBoardV2EnrollmentDescriptor {
  schema: typeof BOARD_V2_ENROLLMENT_SCHEMA
  vaultId: string
  savings: VaultProgramDescriptor
  boarding: VaultBoardV2Descriptor
}

function appendLE32(parts: Uint8Array[], value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  parts.push(bytes)
}

function appendText(parts: Uint8Array[], value: string) {
  const bytes = encodeUtf8(value)
  appendLE32(parts, bytes.length)
  parts.push(bytes)
}

function compositeHash(descriptor: VaultBoardV2EnrollmentDescriptor): string {
  const savingsHash = hashVaultProgramDescriptor(descriptor.savings)
  const fields = [
    descriptor.schema,
    descriptor.vaultId,
    savingsHash,
    descriptor.boarding.schema,
    descriptor.boarding.program,
    descriptor.boarding.template,
    descriptor.boarding.network,
    descriptor.boarding.boardingPub,
    descriptor.boarding.recoveryPhonePub,
    descriptor.boarding.vaultBoardCosignerPub,
    descriptor.boarding.operatorPub,
    descriptor.boarding.exitDelayUnit,
    descriptor.boarding.script,
    descriptor.boarding.address,
  ]
  const parts: Uint8Array[] = []
  for (const field of fields) appendText(parts, field)
  appendLE32(parts, descriptor.boarding.exitDelay)
  const payload = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    payload.set(part, offset)
    offset += part.length
  }
  const digest = bytesToHex(sha256(payload))
  payload.fill(0)
  return digest
}

export function proposedSchema(raw: unknown): string {
  return raw && typeof raw === 'object' ? String((raw as { schema?: string }).schema || '') : ''
}

export function requireProposedProgramDescriptor(raw: unknown, proposedHash: string): VaultProgramDescriptor {
  if (proposedSchema(raw) !== PROGRAM_SCHEMA) throw new Error('enroll needs the current Vault Program descriptor')
  const descriptor = validateVaultProgramDescriptor(raw as VaultProgramDescriptor)
  const hash = hashVaultProgramDescriptor(descriptor)
  if (hash !== proposedHash) throw new Error('proposed descriptor hash does not match this client')
  return descriptor
}

export function requireProposedVaultBoardV2Descriptor(
  raw: unknown,
  proposedHash: string,
  expected: { vaultId: string; phonePub: string; boardingPub: string; network: string },
): VaultBoardV2EnrollmentDescriptor {
  if (!raw || typeof raw !== 'object') throw new Error('enroll needs the vault-board-v2 descriptor')
  const composite = raw as VaultBoardV2EnrollmentDescriptor
  if (composite.schema !== BOARD_V2_ENROLLMENT_SCHEMA || composite.vaultId !== expected.vaultId) {
    throw new Error('enroll needs the current vault-board-v2 descriptor')
  }
  const savings = validateVaultProgramDescriptor(composite.savings)
  if (savings.vaultId !== expected.vaultId || savings.network !== expected.network) {
    throw new Error('vault-board-v2 Savings descriptor does not match enrollment')
  }
  const boarding = requireVaultBoardV2Descriptor(composite.boarding, expected)
  const descriptor = { ...composite, savings, boarding }
  if (compositeHash(descriptor) !== proposedHash) {
    throw new Error('proposed vault-board-v2 descriptor hash does not match this client')
  }
  return descriptor
}

import { PROGRAM_SCHEMA } from './constants'
import { hashVaultProgramDescriptor, validateVaultProgramDescriptor, type VaultProgramDescriptor } from './descriptor'

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

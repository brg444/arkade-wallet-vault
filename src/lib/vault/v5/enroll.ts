import { V5_SCHEMA } from './constants'
import { hashV5Descriptor, validateV5Descriptor, type V5PublicDescriptor } from './descriptor'

export function proposedSchema(raw: unknown): string {
  return raw && typeof raw === 'object' ? String((raw as { schema?: string }).schema || '') : ''
}

export function requireV5ProposedDescriptor(raw: unknown, proposedHash: string): V5PublicDescriptor {
  if (proposedSchema(raw) !== V5_SCHEMA) throw new Error('enroll needs a v5 vault')
  const descriptor = validateV5Descriptor(raw as V5PublicDescriptor)
  const hash = hashV5Descriptor(descriptor)
  if (hash !== proposedHash) throw new Error('proposed descriptor hash does not match this client')
  return descriptor
}

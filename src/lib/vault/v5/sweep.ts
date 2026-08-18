import { V5_TEMPLATE } from './constants'
import type { V5PublicDescriptor } from './descriptor'

export type SweepKind = 'daily' | 'savings'

export function leftoverV4Template(templateVersion?: string): boolean {
  const id = String(templateVersion || '')
  return id.startsWith('phone-direct-p256-routine-3of3-admin-phone-hww-v4')
}

export function sweepDest(descriptor: V5PublicDescriptor, kind: SweepKind): string {
  if (descriptor.templateVersion !== V5_TEMPLATE) throw new Error('sweep dest must be a v5 descriptor')
  return kind === 'daily' ? descriptor.daily.address : descriptor.savings.address
}

export function assertSweepAllowed(input: {
  fromTemplate?: string
  fromAddress: string
  dest: V5PublicDescriptor
  kind: SweepKind
}) {
  if (!leftoverV4Template(input.fromTemplate)) throw new Error('sweep is only for leftover v4 coins')
  const dest = sweepDest(input.dest, input.kind)
  if (!input.fromAddress || input.fromAddress === dest) throw new Error('sweep source and dest must differ')
  return dest
}

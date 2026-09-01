import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildVaultProgramDescriptor, hashVaultProgramDescriptor } from './descriptor'
import { PROGRAM_FIXTURE } from './fixtures'
import { requiredGuardianExitSigners } from './guardianExit'
import { clawbackWitnessBytes, initiateWitnessBytes } from './script'

const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, 'savings-vectors.json'), 'utf8')) as {
  name: string
  recovery: boolean
  savings: { address: string; script: string }
  descriptorHash: string
  pending: Record<string, { address: string; script: string }>
  quarantine: Record<string, { address: string; script: string }>
}[]

describe('frozen Savings program vectors', () => {
  it('pins cancel signers and transition witness sizes', () => {
    expect(requiredGuardianExitSigners('phone', true)).toEqual(['hardware', 'recovery'])
    expect(requiredGuardianExitSigners('hardware', false)).toEqual(['phone'])
    expect(initiateWitnessBytes('phone', true)).toBe(399)
    expect(initiateWitnessBytes('hardware', false)).toBe(367)
    expect(clawbackWitnessBytes(true, true)).toBe(431)
  })

  it.each(vectors)('matches $name', (vector) => {
    const descriptor = buildVaultProgramDescriptor({
      ...PROGRAM_FIXTURE,
      protectionTier: vector.recovery ? 'advanced' : 'standard',
      recoveryPub: vector.recovery ? PROGRAM_FIXTURE.recoveryPub : undefined,
    })
    expect(descriptor.savings).toEqual(vector.savings)
    expect(hashVaultProgramDescriptor(descriptor)).toBe(vector.descriptorHash)
    for (const [key, tree] of Object.entries(vector.pending)) {
      expect(descriptor.pending[key as keyof typeof descriptor.pending]).toMatchObject(tree)
    }
    for (const [key, tree] of Object.entries(vector.quarantine)) {
      expect(descriptor.quarantine[key as keyof typeof descriptor.quarantine]).toMatchObject(tree)
    }
  })
})

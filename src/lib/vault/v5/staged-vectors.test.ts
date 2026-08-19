import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hex } from '@scure/base'
import { hashV5Descriptor, buildV5Descriptor } from './descriptor'
import { V5_FIXTURE, V6_FIXTURE } from './fixtures'
import { requiredGuardianExitSigners } from './guardianExit'
import { clawbackWitnessBytes, initiateWitnessBytes } from './script'
import { buildV5Family } from './trees'

const file = JSON.parse(readFileSync(resolve(import.meta.dirname, 'staged-vectors.json'), 'utf8')) as {
  requiredGuardians: Record<string, { withRecovery: string[]; withoutRecovery?: string[] }>
  witnessBytes: {
    initiateDailyPhoneOrHardwareWithRecovery: number
    clawbackServerFreeWithRecovery: number
    initiateSavingsHardwareWithoutRecovery: number
  }
  vectors: {
    name: string
    template: string
    recovery: boolean
    daily: string
    savings: string
    descriptorHash: string
    pending: Record<string, string>
    quarantine: Record<string, string>
    initiateAuth: Record<string, string>
    clawbackAuth: Record<string, string>
    guardianExit: Record<string, string>
  }[]
}

describe('frozen staged vectors', () => {
  it('pins remaining cancel signers and witness sizes', () => {
    expect(requiredGuardianExitSigners('phone', true)).toEqual(file.requiredGuardians.phone.withRecovery)
    expect(requiredGuardianExitSigners('hardware', false)).toEqual(file.requiredGuardians.hardware.withoutRecovery)
    expect(initiateWitnessBytes('daily', 'phone', true)).toBe(
      file.witnessBytes.initiateDailyPhoneOrHardwareWithRecovery,
    )
    expect(clawbackWitnessBytes(true, true)).toBe(file.witnessBytes.clawbackServerFreeWithRecovery)
    expect(initiateWitnessBytes('savings', 'hardware', false)).toBe(
      file.witnessBytes.initiateSavingsHardwareWithoutRecovery,
    )
  })

  it.each(file.vectors)('matches $name', (vec) => {
    const base = vec.template.endsWith('v6') ? V6_FIXTURE : V5_FIXTURE
    const descriptor = buildV5Descriptor({
      ...base,
      templateVersion: vec.template as typeof base.templateVersion,
      recoveryPub: vec.recovery ? base.recoveryPub : undefined,
    })
    expect(descriptor.daily.address).toBe(vec.daily)
    expect(descriptor.savings.address).toBe(vec.savings)
    expect(hashV5Descriptor(descriptor)).toBe(vec.descriptorHash)
    for (const [key, want] of Object.entries(vec.pending)) {
      expect(descriptor.pending[key as keyof typeof descriptor.pending].address).toBe(want)
    }
    for (const [key, want] of Object.entries(vec.quarantine)) {
      expect(descriptor.quarantine[key as keyof typeof descriptor.quarantine].address).toBe(want)
    }
    const family = buildV5Family({
      ...base,
      templateVersion: vec.template,
      recoveryPub: vec.recovery ? base.recoveryPub : undefined,
    })
    for (const [key, want] of Object.entries(vec.initiateAuth)) {
      expect(hex.encode(family.initiateAuth[key as keyof typeof family.initiateAuth])).toBe(want)
    }
    for (const [key, want] of Object.entries(vec.clawbackAuth)) {
      expect(hex.encode(family.clawbackAuth[key as keyof typeof family.clawbackAuth])).toBe(want)
    }
    for (const [key, want] of Object.entries(vec.guardianExit || {})) {
      expect(hex.encode(family.pending[key as keyof typeof family.pending].guardianExit!)).toBe(want)
    }
  })
})

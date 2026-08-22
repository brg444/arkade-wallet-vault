import { describe, expect, it } from 'vitest'
import { buildVaultProgramDescriptor } from './descriptor'
import { PROGRAM_FIXTURE } from './fixtures'
import { buildRecoveryKit, inspectRecoveryKit, parseRecoveryKit } from './kit'

describe('Recovery Kit', () => {
  it('rebuilds the descriptor and lists all 14 trees', () => {
    const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE))
    const report = inspectRecoveryKit(kit)
    expect(report.hash).toBe(kit.descriptorHash)
    expect(report.trees).toHaveLength(14)
    expect(report.trees.some((tree) => tree.role === 'daily')).toBe(true)
    expect(report.trees.some((tree) => tree.delay === 288)).toBe(true)
    expect(report.warnings.some((line) => /cannot exit a Normal/.test(line))).toBe(true)
    expect(parseRecoveryKit(JSON.parse(JSON.stringify(kit))).descriptorHash).toBe(kit.descriptorHash)
  })

  it('rejects a tampered hash', () => {
    const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE))
    expect(() => parseRecoveryKit({ ...kit, descriptorHash: '00'.repeat(32) })).toThrow(/hash/)
    expect(() => parseRecoveryKit({ name: 'emergency-exit', version: 1, descriptor: kit.descriptor })).toThrow(
      /Recovery Kit/,
    )
  })
})

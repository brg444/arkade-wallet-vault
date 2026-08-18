import { describe, expect, it } from 'vitest'
import { buildV5Descriptor, familyFromDescriptor } from './descriptor'
import { V5_FIXTURE } from './fixtures'
import { buildRecoveryKit } from './kit'
import { parseKitCli, runKitCli } from './kitCli'
import { inspectTransitionPsbt } from './spend'

function fixtureKit() {
  return buildRecoveryKit(buildV5Descriptor(V5_FIXTURE))
}

describe('v5 Recovery Kit CLI', () => {
  it('inspects every tree and rebuilds the family from the kit', () => {
    const kit = fixtureKit()
    const out = runKitCli({ name: 'inspect', kit })
    expect(out).toContain(kit.descriptor.daily.address)
    expect(out).toContain(kit.descriptor.pending['savings-hardware'].address)
    expect(out).toContain('cannot exit a Normal')
    const family = familyFromDescriptor(kit.descriptor)
    expect(family.daily.address).toBe(kit.descriptor.daily.address)
    expect(family.pending['daily-recovery'].address).toBe(kit.descriptor.pending['daily-recovery'].address)
  })

  it('builds an initiate PSBT from CLI flags', () => {
    const kit = fixtureKit()
    const cmd = parseKitCli(
      [
        'initiate',
        'kit.json',
        '--kind',
        'savings',
        '--claimant',
        'hardware',
        '--txid',
        '11'.repeat(32),
        '--vout',
        '0',
        '--value',
        '50000',
        '--fee',
        '500',
      ],
      () => kit,
    )
    const out = runKitCli(cmd)
    const [dest, psbt] = out.split('\n')
    expect(dest).toBe(kit.descriptor.pending['savings-hardware'].address)
    expect(inspectTransitionPsbt(psbt).p2aSats).toBe(240)
  })

  it('reports remaining CSV from chain heights, not Normal UTXO age', () => {
    const kit = fixtureKit()
    const cmd = parseKitCli(
      ['status', 'kit.json', '--kind', 'savings', '--claimant', 'hardware', '--tip', '105', '--height', '100'],
      () => kit,
    )
    const out = runKitCli(cmd)
    expect(out).toContain('state claimable')
    expect(out).toContain('remaining 0')
    const early = runKitCli(
      parseKitCli(
        ['status', 'kit.json', '--kind', 'savings', '--claimant', 'hardware', '--tip', '104', '--height', '100'],
        () => kit,
      ),
    )
    expect(early).toContain('state pending')
    expect(early).toContain('remaining 1')
    expect(early).toContain('claimable no')
  })

  it('refuses a suspect clawback from the CLI', () => {
    const kit = fixtureKit()
    const cmd = parseKitCli(
      [
        'clawback',
        'kit.json',
        '--kind',
        'savings',
        '--claimant',
        'hardware',
        '--guardian',
        'hardware',
        '--txid',
        '11'.repeat(32),
        '--vout',
        '0',
        '--value',
        '50000',
        '--fee',
        '500',
      ],
      () => kit,
    )
    expect(() => runKitCli(cmd)).toThrow(/guardian/)
  })
})

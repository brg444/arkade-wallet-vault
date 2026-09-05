import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe.each(['mutinynet', 'mainnet'] as const)('emergency Recovery Kit compatibility on %s', (network) => {
  it.each(['standard', 'advanced'] as const)('preserves the %s kit and its recovery trees', async (protectionTier) => {
    vi.stubEnv('VITE_VAULT_RELEASE_NETWORK', network)
    vi.resetModules()
    const { PROGRAM_FIXTURE } = await import('./fixtures')
    const { buildVaultProgramDescriptor } = await import('./descriptor')
    const { buildRecoveryKit, inspectRecoveryKit } = await import('./kit')
    const emergency = await import('../../../../tools/offline-recovery/src/lib/vault/program/kit')
    const { extractRecoveryKitJson } = await import(
      '../../../../tools/offline-recovery/src/lib/vault/program/kitBundle'
    )
    const kit = buildRecoveryKit(
      buildVaultProgramDescriptor({
        ...PROGRAM_FIXTURE,
        network,
        protectionTier,
        recoveryPub: protectionTier === 'advanced' ? PROGRAM_FIXTURE.recoveryPub : undefined,
      }),
    )

    const file = new TextEncoder().encode(JSON.stringify(kit))
    const recovered = emergency.parseRecoveryKit(JSON.parse(extractRecoveryKitJson(file)))
    expect(recovered).toEqual(kit)
    expect(emergency.inspectRecoveryKit(recovered).trees).toEqual(inspectRecoveryKit(kit).trees)
    // The released wallet exports public v3 maps, not an independent phone unlock.
    expect(emergency.kitHasUnlock(recovered)).toBe(false)
    expect(() => emergency.parseRecoveryKit({ ...recovered, descriptorHash: '00'.repeat(32) })).toThrow(/hash/)
  })
})

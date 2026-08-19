import { describe, expect, it } from 'vitest'
import { scalarSecret, V5_FIXTURE, V6_FIXTURE } from './fixtures'
import { buildV5Descriptor } from './descriptor'
import { buildRecoveryKit } from './kit'
import { isPreviewDescriptor } from './liveKit'
import { previewV5Descriptor } from './preview'
import { xOnly } from '../setupPlan'
import { V5_TEMPLATE, V6_TEMPLATE } from './constants'
import type { VaultStatus } from '../types'
import {
  buildMapBackup,
  evenYCompressed,
  kitFromFacts,
  parseMapBackup,
  pushMapBackup,
  unwrapMapWithHardware,
  wrapMapForHardware,
} from './kitBackup'

function statusFromDescriptor(
  descriptor: ReturnType<typeof buildV5Descriptor>,
  extra: Partial<VaultStatus> = {},
): VaultStatus {
  return {
    enrolled: true,
    network: descriptor.network,
    clientOrigin: 'https://arkade-vault-demo.vercel.app',
    rpId: 'arkade-vault-demo.vercel.app',
    vaultId: descriptor.vaultId,
    templateVersion: descriptor.templateVersion,
    policyVersion: descriptor.policyVersion,
    operationalCsvBlocks: 144,
    savingsCsvBlocks: 6,
    externalOwnerWalletPub: descriptor.keys.hardware,
    vaultCosignerBasePub: descriptor.keys.vaultCosignerBase,
    arkadeCosignerBasePub: descriptor.keys.arkadeCosignerBase,
    arkadeCosignerOrigin: descriptor.arkadeCosigner.origin,
    arkadeCosignerVersion: descriptor.arkadeCosigner.version,
    operationalAddress: descriptor.daily.address,
    savingsAddress: descriptor.savings.address,
    savingsExcludesRoutineCosigners: true,
    periodAllowance: 100_000,
    periodSpent: 0,
    periodRemaining: 100_000,
    txCap: 50_000,
    absoluteFeeCap: 5_000,
    feerateCapSatVb: 10,
    phoneRoutineBip340Pub: descriptor.keys.phoneRoutineBip340,
    phoneDirectP256: descriptor.keys.phoneDirectP256,
    tweakedVaultCosignerXOnly: xOnly(descriptor.tweaks.routine.vault),
    tweakedArkadeCosignerXOnly: xOnly(descriptor.tweaks.routine.arkade),
    recoveryPub: descriptor.keys.recovery,
    ...extra,
  }
}

describe('vault map backup', () => {
  it('wraps only the public kit', () => {
    const kit = buildRecoveryKit(
      previewV5Descriptor({ hardwarePub: V5_FIXTURE.hardwarePub, recoveryPub: V5_FIXTURE.recoveryPub }),
    )
    const backup = buildMapBackup(kit, '2026-08-18T00:00:00.000Z')
    expect(backup.name).toBe('arkade-vault-map')
    expect(backup.kit).not.toHaveProperty('secret')
    expect(JSON.stringify(Object.keys(backup))).not.toMatch(/secret|mnemonic|seed/)
    expect(parseMapBackup(backup).kit.descriptorHash).toBe(kit.descriptorHash)
  })

  it('rebuilds the preview map from the same public keys', () => {
    const kit = kitFromFacts({
      hardwarePub: V5_FIXTURE.hardwarePub,
      recoveryPub: V5_FIXTURE.recoveryPub,
      enrollment: {
        vaultId: V5_FIXTURE.vaultId,
        phoneRoutineBip340Pub: V5_FIXTURE.phonePub,
        phoneDirectP256: V5_FIXTURE.phoneDirectP256,
      },
    })
    expect(kit?.descriptor.daily.address).toBe(
      previewV5Descriptor({
        vaultId: V5_FIXTURE.vaultId,
        hardwarePub: V5_FIXTURE.hardwarePub,
        recoveryPub: V5_FIXTURE.recoveryPub,
        phonePub: V5_FIXTURE.phonePub,
        phoneDirectP256: V5_FIXTURE.phoneDirectP256,
      }).daily.address,
    )
  })

  it('needs a recovery key to build a map', () => {
    expect(kitFromFacts({ hardwarePub: V5_FIXTURE.hardwarePub })).toBeNull()
  })

  it('lifts an x-only tweak to even-Y compressed', () => {
    expect(evenYCompressed(xOnly(V5_FIXTURE.routineVault))).toMatch(/^02[0-9a-f]{64}$/)
  })

  it('wraps the map to hardware and opens it with that key only', async () => {
    const kit = buildRecoveryKit(
      previewV5Descriptor({ hardwarePub: V5_FIXTURE.hardwarePub, recoveryPub: V5_FIXTURE.recoveryPub }),
    )
    const wrap = await wrapMapForHardware(kit, V5_FIXTURE.hardwarePub)
    expect(wrap.hardwareXOnly).toBe(xOnly(V5_FIXTURE.hardwarePub))
    const opened = await unwrapMapWithHardware(wrap, scalarSecret(4))
    expect(opened.descriptorHash).toBe(kit.descriptorHash)
    await expect(unwrapMapWithHardware(wrap, scalarSecret(5))).rejects.toThrow(/hardware key/)
  })

  it('rebuilds leftover v5 and live v6 maps from status facts', () => {
    const v5 = buildV5Descriptor({
      ...V5_FIXTURE,
      routineVault: evenYCompressed(xOnly(V5_FIXTURE.routineVault)),
      routineArkade: evenYCompressed(xOnly(V5_FIXTURE.routineArkade)),
    })
    const v6 = buildV5Descriptor({
      ...V6_FIXTURE,
      routineVault: evenYCompressed(xOnly(V6_FIXTURE.routineVault)),
      routineArkade: evenYCompressed(xOnly(V6_FIXTURE.routineArkade)),
    })
    expect(v5.daily.address).not.toBe(v6.daily.address)
    const leftover = kitFromFacts({ status: statusFromDescriptor(v5) })
    const live = kitFromFacts({ status: statusFromDescriptor(v6) })
    expect(leftover?.descriptor.templateVersion).toBe(V5_TEMPLATE)
    expect(live?.descriptor.templateVersion).toBe(V6_TEMPLATE)
    expect(leftover?.descriptor.daily.address).toBe(v5.daily.address)
    expect(live?.descriptor.daily.address).toBe(v6.daily.address)
    expect(leftover?.descriptorHash).toBe(buildRecoveryKit(v5).descriptorHash)
    expect(live?.descriptorHash).toBe(buildRecoveryKit(v6).descriptorHash)
  })

  it('does not silently rebuild a live v5 status as v6', () => {
    const v5 = buildV5Descriptor({
      ...V5_FIXTURE,
      routineVault: evenYCompressed(xOnly(V5_FIXTURE.routineVault)),
      routineArkade: evenYCompressed(xOnly(V5_FIXTURE.routineArkade)),
    })
    const rebuilt = kitFromFacts({ status: statusFromDescriptor(v5) })
    expect(rebuilt?.descriptor.templateVersion).toBe(V5_TEMPLATE)
    expect(rebuilt?.descriptor.daily.address).not.toBe(buildV5Descriptor(V6_FIXTURE).daily.address)
  })

  it('keeps preview kits off the live upload path', async () => {
    const preview = buildRecoveryKit(
      previewV5Descriptor({ hardwarePub: V5_FIXTURE.hardwarePub, recoveryPub: V5_FIXTURE.recoveryPub }),
    )
    expect(isPreviewDescriptor(preview.descriptor)).toBe(true)
    await expect(pushMapBackup(preview.descriptor.vaultId, preview)).rejects.toThrow(/preview map/)
    expect(
      kitFromFacts({
        status: statusFromDescriptor(buildV5Descriptor(V6_FIXTURE), {
          enrolled: true,
          vaultCosignerBasePub: undefined,
        }),
        hardwarePub: V6_FIXTURE.hardwarePub,
        recoveryPub: V6_FIXTURE.recoveryPub,
      }),
    ).toBeNull()
  })
})

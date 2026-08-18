import { describe, expect, it } from 'vitest'
import { scalarSecret, V5_FIXTURE } from './fixtures'
import { buildRecoveryKit } from './kit'
import { previewV5Descriptor } from './preview'
import { xOnly } from '../setupPlan'
import {
  buildMapBackup,
  evenYCompressed,
  kitFromFacts,
  parseMapBackup,
  unwrapMapWithHardware,
  wrapMapForHardware,
} from './kitBackup'

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
})

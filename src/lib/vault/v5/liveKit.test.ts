import { describe, expect, it } from 'vitest'
import { buildV5Descriptor } from './descriptor'
import { V5_FIXTURE, V6_FIXTURE } from './fixtures'
import { buildRecoveryKit } from './kit'
import { kitMatchesLiveVault, selectLiveKit, watcherEnabledForTemplate } from './liveKit'
import { previewV5Descriptor } from './preview'
import { V5_TEMPLATE, V6_TEMPLATE } from './constants'

describe('live kit and watcher policy', () => {
  it('starts the watcher for leftover v5 and live v6, not leftover v4', () => {
    expect(watcherEnabledForTemplate(V5_TEMPLATE)).toBe(true)
    expect(watcherEnabledForTemplate(V6_TEMPLATE)).toBe(true)
    expect(watcherEnabledForTemplate('phone-direct-p256-routine-3of3-admin-phone-hww-v4')).toBe(false)
    expect(watcherEnabledForTemplate('')).toBe(false)
  })

  it('rejects a kit for another vault or the wrong template', () => {
    const kit = buildRecoveryKit(buildV5Descriptor(V6_FIXTURE))
    expect(kitMatchesLiveVault(kit, V6_FIXTURE.vaultId, V6_TEMPLATE)).toBe(true)
    expect(kitMatchesLiveVault(kit, 'other-vault-id-000000000000000000000000', V6_TEMPLATE)).toBe(false)
    expect(kitMatchesLiveVault(kit, V6_FIXTURE.vaultId, V5_TEMPLATE)).toBe(false)
    expect(selectLiveKit({ vaultId: V6_FIXTURE.vaultId, templateVersion: V6_TEMPLATE, stored: kit })).toBe(kit)
    expect(
      selectLiveKit({
        vaultId: 'other-vault-id-000000000000000000000000',
        templateVersion: V6_TEMPLATE,
        stored: kit,
      }),
    ).toBeNull()
  })

  it('never treats a preview kit as a live watcher source', () => {
    const preview = buildRecoveryKit(
      previewV5Descriptor({
        vaultId: V6_FIXTURE.vaultId,
        hardwarePub: V6_FIXTURE.hardwarePub,
        recoveryPub: V6_FIXTURE.recoveryPub,
      }),
    )
    expect(selectLiveKit({ vaultId: V6_FIXTURE.vaultId, templateVersion: V6_TEMPLATE, stored: preview })).toBeNull()
    expect(kitMatchesLiveVault(preview, V6_FIXTURE.vaultId, V5_TEMPLATE)).toBe(false)
  })

  it('does not start a v4 leftover watcher even if a staged kit is sitting in storage', () => {
    const kit = buildRecoveryKit(buildV5Descriptor(V5_FIXTURE))
    expect(
      selectLiveKit({
        vaultId: V5_FIXTURE.vaultId,
        templateVersion: 'phone-direct-p256-routine-3of3-admin-phone-hww-v4',
        stored: kit,
      }),
    ).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { buildVaultProgramDescriptor } from './descriptor'
import { PROGRAM_FIXTURE } from './fixtures'
import { buildRecoveryKit, parseRecoveryKit } from './kit'
import {
  extractRecoveryKitJson,
  packRecoveryKit,
  RECOVERY_GUIDE,
  recoveryKitArchiveName,
  recoveryKitLabel,
} from './kitBundle'

const unlock = {
  prfSalt: 'arkade-2fa-vault/prf/v1' as const,
  kekInfo: 'arkade-2fa-vault/kek/v1' as const,
  credId: 'aa',
  webauthnP256: '02' + 'ab'.repeat(32),
  nonce: '11'.repeat(12),
  ciphertext: '22'.repeat(48),
}

describe('Recovery Kit archive', () => {
  it('names the zip with the date, protection, and site', () => {
    const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE), {
      rpId: 'rc.getvaulted.xyz',
      clientOrigin: 'https://rc.getvaulted.xyz',
      unlock,
    })
    expect(recoveryKitArchiveName(kit, new Date('2026-09-04T12:00:00.000Z'))).toBe(
      'Vaulted Recovery 2026-09-04 Advanced rc.getvaulted.xyz.zip',
    )
    expect(recoveryKitLabel(kit)).toMatch(/Advanced/)
    expect(recoveryKitLabel(kit)).toMatch(/rc.getvaulted.xyz/)
  })

  it('packs the kit with the how-to note and reads the json back', () => {
    const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE), {
      rpId: 'rc.getvaulted.xyz',
      clientOrigin: 'https://rc.getvaulted.xyz',
      unlock,
    })
    const packed = packRecoveryKit(kit, new Date('2026-09-04T12:00:00.000Z'))
    const json = extractRecoveryKitJson(packed.bytes)
    expect(parseRecoveryKit(JSON.parse(json)).rpId).toBe('rc.getvaulted.xyz')
    expect(RECOVERY_GUIDE).toMatch(/Keep this note with Recovery Kit.json/)
    expect(RECOVERY_GUIDE).not.toMatch(/version 4/i)
    expect(RECOVERY_GUIDE).not.toMatch(/RP ID/)
    expect(RECOVERY_GUIDE).not.toMatch(/envelope/i)
  })

  it('reads a raw json kit and a map-only filename', () => {
    const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE))
    const json = `${JSON.stringify(kit, null, 2)}\n`
    expect(parseRecoveryKit(JSON.parse(extractRecoveryKitJson(new TextEncoder().encode(json)))).protectionTier).toBe(
      'advanced',
    )
    expect(recoveryKitArchiveName(kit, new Date('2026-09-04T00:00:00.000Z'))).toBe(
      'Vaulted Recovery 2026-09-04 Advanced vaulted.zip',
    )
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POLICY_VERSION, TEMPLATE_VERSION, VAULT_SCHEMA } from './constants'
import { enrollmentPoPDigest } from './tenantEnrollment'
import { V5_RECOVERY_POP_TAG, V5_SCHEMA, V5_TEMPLATE } from './v5/constants'
import pack from './contract-pack.json'

describe('frozen wallet protocol domains', () => {
  it('matches the published contract pack', () => {
    expect(VAULT_SCHEMA).toBe(pack.programs.v4.schema)
    expect(TEMPLATE_VERSION).toBe(pack.programs.v4.template)
    expect(POLICY_VERSION).toBe(pack.programs.v4.policy)
    expect(V5_SCHEMA).toBe(pack.programs.v5.schema)
    expect(V5_TEMPLATE).toBe(pack.programs.v5.template)
    expect(V5_RECOVERY_POP_TAG).toBe(pack.programs.v5.recoveryPopTag)
    expect(pack.programs.v4.status).toBe('leftover')
    expect(pack.programs.v5.status).toBe('live')
    expect(pack.programs.v5.recovery).toBe('optional')
  })

  it('pins leftover v4 strings and the live v5 enroll program', () => {
    expect(VAULT_SCHEMA).toBe('arkade-vault/v4')
    expect(TEMPLATE_VERSION).toBe('phone-direct-p256-routine-3of3-admin-phone-hww-v4')
    expect(POLICY_VERSION).toBe('mandatory-change-tx50k-day100k-fee5k-feerate10-onchain-v3')
    expect(V5_TEMPLATE).toBe('phone-hww-recovery-staged-v5')
  })

  it('pins the v5 schema, template, and recovery PoP tag', () => {
    expect(V5_SCHEMA).toBe('arkade-vault/v5')
    expect(V5_TEMPLATE).toBe('phone-hww-recovery-staged-v5')
    expect(V5_RECOVERY_POP_TAG).toBe('arkade-vault/v5/recovery-pop')
  })

  it('pins client HKDF and enrollment domains in source', () => {
    const enroll = readFileSync(resolve(import.meta.dirname, 'tenantEnrollment.ts'), 'utf8')
    expect(enroll).toContain('arkade-2fa-vault/prf/v1')
    expect(enroll).toContain('arkade-2fa-vault/kek/v1')
    expect(enroll).toContain('arkade-2fa-vault/direct-p256/v1')
    expect(enroll).toContain('arkade-2fa-vault/enrollment-pop/v3')
    const binding = readFileSync(resolve(import.meta.dirname, 'passkeyBinding.ts'), 'utf8')
    expect(binding).toContain('arkade-2fa-vault/recovery-binding/v1')
    expect(binding).toContain('arkade-2fa-vault/passkey-proof/v1')
  })

  it('does not include a recovery proof in the enrollment digest', () => {
    const digest = enrollmentPoPDigest({
      vaultId: 'tenant-b',
      credentialId: 'aa',
      webauthnP256: '02' + '11'.repeat(32),
      phoneDirectP256: '03' + '22'.repeat(32),
      phoneRoutineBip340Pub: '02' + '33'.repeat(32),
      externalOwnerWalletXOnly: '44'.repeat(32),
      descriptorHash: '66'.repeat(32),
    })
    expect(digest.length).toBe(32)
  })
})

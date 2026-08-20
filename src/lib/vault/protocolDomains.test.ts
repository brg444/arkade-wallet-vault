import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POLICY_VERSION } from './constants'
import { enrollmentPoPDigest } from './tenantEnrollment'
import { V5_RECOVERY_POP_TAG, V5_SCHEMA, STAGED_TEMPLATE } from './v5/constants'
import pack from './contract-pack.json'

describe('frozen wallet protocol domains', () => {
  it('matches the published contract pack', () => {
    expect(POLICY_VERSION).toBe(pack.programs.staged.policy)
    expect(V5_SCHEMA).toBe(pack.programs.staged.schema)
    expect(STAGED_TEMPLATE).toBe(pack.programs.staged.template)
    expect(V5_RECOVERY_POP_TAG).toBe(pack.programs.staged.recoveryPopTag)
    expect(pack.programs.staged.status).toBe('live')
    expect(pack.programs.staged.enrollable).toBe(true)
    expect(pack.programs.staged.recovery).toBe('optional')
  })

  it('pins the live staged program', () => {
    expect(POLICY_VERSION).toBe('mandatory-change-tx50k-day100k-fee5k-feerate10-onchain-v3')
    expect(STAGED_TEMPLATE).toBe('phone-hww-recovery-staged-v6')
  })

  it('lists vault-policy-v1 as 3-key collaborative spend beside staged', () => {
    const listed = pack.programs['vault-policy-v1']
    expect(listed.status).toBe('listed')
    expect(listed.module).toBe('vtxo')
    expect(listed.template).toBe('vault-policy-v1-collaborative-3key')
    expect(listed.spend.leaf).toBe('user-and-vtxo-vault-cosigner-and-arkd')
    expect(listed.spend.note).toContain('VaultCosigner independently enforces the Vault Program')
    expect(listed.notes).toContain('3-key [user, VTXO VaultCosigner, Arkade Operator]')
  })

  it('pins the staged schema and recovery PoP tag', () => {
    expect(V5_SCHEMA).toBe('arkade-vault/v5')
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

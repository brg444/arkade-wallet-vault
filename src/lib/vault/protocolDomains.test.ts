import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POLICY_VERSION } from './constants'
import { PROGRAM_SCHEMA, SAVINGS_TEMPLATE } from './program/constants'
import pack from './contract-pack.json'

describe('frozen wallet protocol domains', () => {
  it('matches the published contract pack', () => {
    const savings = pack.programs['savings-recovery-v1']
    expect(POLICY_VERSION).toBe(savings.policy)
    expect(PROGRAM_SCHEMA).toBe(savings.schema)
    expect(SAVINGS_TEMPLATE).toBe(savings.template)
    expect(savings.status).toBe('live')
    expect(savings.enrollable).toBe(true)
    expect(savings.recovery).toBe('optional')
  })

  it('pins the live Savings program', () => {
    expect(POLICY_VERSION).toBe('vault-spending-policy-v1')
    expect(SAVINGS_TEMPLATE).toBe('phone-hww-recovery-savings-v1')
  })

  it('lists vault-policy-v1 as 3-key collaborative spend beside Savings', () => {
    const listed = pack.programs['vault-policy-v1']
    expect(listed.status).toBe('listed')
    expect(listed.module).toBe('vtxo')
    expect(listed.template).toBe('vault-policy-v1-collaborative-3key')
    expect(listed.spend.leaf).toBe('user-and-vtxo-vault-cosigner-and-arkd')
    expect(listed.spend.note).toContain('VaultCosigner independently enforces the Vault Program')
    expect(listed.notes).toContain('3-key [user, VTXO VaultCosigner, Arkade Operator]')
  })

  it('pins the Savings schema', () => {
    expect(PROGRAM_SCHEMA).toBe('arkade-vault/savings-v1')
  })

  it('pins client HKDF domains in source', () => {
    const enroll = readFileSync(resolve(import.meta.dirname, 'tenantEnrollment.ts'), 'utf8')
    expect(enroll).toContain('arkade-2fa-vault/prf/v1')
    expect(enroll).toContain('arkade-2fa-vault/kek/v1')
    expect(enroll).toContain('arkade-2fa-vault/direct-p256/v1')
    const binding = readFileSync(resolve(import.meta.dirname, 'passkeyBinding.ts'), 'utf8')
    expect(binding).toContain('arkade-vault/recovery-binding/v3')
    expect(binding).toContain('arkade-2fa-vault/passkey-proof/v1')
  })

  it('does not publish enrollment ownership-proof contracts', () => {
    expect('enrollmentPop' in pack.domains).toBe(false)
    expect('recoveryPopTag' in pack.programs['savings-recovery-v1']).toBe(false)
  })
})

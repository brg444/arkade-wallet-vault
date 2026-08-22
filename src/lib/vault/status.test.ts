import { afterEach, describe, expect, it, vi } from 'vitest'
import { POLICY_VERSION } from './constants'
import { SAVINGS_TEMPLATE } from './program/constants'
import { parseStatusJson, pingVaultService, requireStatusIdentity, vaultStatusPath } from './status'
import type { VaultStatus } from './types'

const VAULT_ID = 'vault-test-current'

function sampleStatus(over: Partial<VaultStatus> = {}): VaultStatus {
  return {
    enrolled: true,
    network: 'mutinynet',
    clientOrigin: 'https://vault.example',
    rpId: 'vault.example',
    vaultId: VAULT_ID,
    templateVersion: SAVINGS_TEMPLATE,
    policyVersion: POLICY_VERSION,
    savingsAddress: 'tb1ptest',
    savingsScript: '5120' + 'aa'.repeat(32),
    periodAllowance: 100_000,
    periodSpent: 0,
    periodRemaining: 100_000,
    txCap: 50_000,
    absoluteFeeCap: 5_000,
    feerateCapSatVb: 10,
    ...over,
  }
}

describe('status identity binding', () => {
  it('requires the selected vault id and refuses a wrong-vault response', () => {
    expect(requireStatusIdentity(sampleStatus(), VAULT_ID).vaultId).toBe(VAULT_ID)
    expect(() => requireStatusIdentity(sampleStatus(), 'tenant-b')).toThrow(/vault id/)
    expect(() => requireStatusIdentity(sampleStatus(), '')).toThrow(/vault id required/)
  })

  it('binds serialized status and the request path to an explicit vault', () => {
    const raw = JSON.stringify(sampleStatus({ vaultId: 'tenant-b' }))
    expect(parseStatusJson(raw, 'tenant-b').vaultId).toBe('tenant-b')
    expect(() => parseStatusJson(raw, VAULT_ID)).toThrow(/vault id/)
    expect(vaultStatusPath('tenant-b')).toBe('/v1/status?vault=tenant-b')
    expect(() => vaultStatusPath('')).toThrow(/vault id required/)
  })

  it('accepts only the current Savings template', () => {
    expect(() =>
      requireStatusIdentity(sampleStatus({ templateVersion: 'phone-hww-recovery-staged-v5' }), VAULT_ID),
    ).toThrow(/template version/)
    expect(requireStatusIdentity(sampleStatus(), VAULT_ID).templateVersion).toBe(SAVINGS_TEMPLATE)
  })

  it('requires the Savings descriptor but no retired Daily account', () => {
    expect(() => requireStatusIdentity(sampleStatus({ savingsScript: '' }), VAULT_ID)).toThrow(/Savings descriptor/)
    expect(requireStatusIdentity(sampleStatus(), VAULT_ID)).not.toHaveProperty('operationalAddress')
  })
})

describe('pingVaultService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is online when public status answers this release', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              network: 'mutinynet',
              clientOrigin: 'https://vault.example',
              rpId: 'vault.example',
              templateVersion: SAVINGS_TEMPLATE,
              policyVersion: POLICY_VERSION,
              enrollmentMode: 'invite',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    await expect(pingVaultService()).resolves.toBe(true)
  })

  it('is down when the service does not answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Failed to fetch')
      }),
    )
    await expect(pingVaultService()).resolves.toBe(false)
  })
})

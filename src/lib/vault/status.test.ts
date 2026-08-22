import { afterEach, describe, expect, it, vi } from 'vitest'
import { POLICY_VERSION } from './constants'
import { STAGED_TEMPLATE } from './program/constants'
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
    templateVersion: STAGED_TEMPLATE,
    policyVersion: POLICY_VERSION,
    operationalCsvBlocks: 144,
    savingsCsvBlocks: 6,
    operationalAddress: 'tb1p9llcrjjkzr57py6vffwveztm0hn0hezj7wzrq5mat6nh07j37g4qh8jl0l',
    savingsAddress: 'tb1ptest',
    savingsExcludesRoutineCosigners: true,
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

  it('accepts only the current staged template', () => {
    expect(() =>
      requireStatusIdentity(sampleStatus({ templateVersion: 'phone-hww-recovery-staged-v5' }), VAULT_ID),
    ).toThrow(/template version/)
    expect(requireStatusIdentity(sampleStatus(), VAULT_ID).templateVersion).toBe(STAGED_TEMPLATE)
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
              templateVersion: STAGED_TEMPLATE,
              policyVersion: POLICY_VERSION,
              operationalCsvBlocks: 144,
              savingsCsvBlocks: 6,
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

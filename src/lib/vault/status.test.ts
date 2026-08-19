import { afterEach, describe, expect, it, vi } from 'vitest'
import { POLICY_VERSION, TEMPLATE_VERSION, VAULT_ID } from './constants'
import { V5_TEMPLATE } from './v5/constants'
import { parseStatusJson, pingVaultService, requireStatusIdentity, vaultStatusPath } from './status'
import type { VaultStatus } from './types'

function sampleStatus(over: Partial<VaultStatus> = {}): VaultStatus {
  return {
    enrolled: true,
    network: 'mutinynet',
    clientOrigin: 'https://arkade-vault-demo.vercel.app',
    rpId: 'arkade-vault-demo.vercel.app',
    vaultId: VAULT_ID,
    templateVersion: TEMPLATE_VERSION,
    policyVersion: POLICY_VERSION,
    operationalCsvBlocks: 144,
    savingsCsvBlocks: 6,
    operationalAddress: 'tb1p9llcrjjkzr57py6vffwveztm0hn0hezj7wzrq5mat6nh07j37g4qh8jl0l',
    savingsAddress: 'tb1ptest',
    savingsExcludesRoutineCosigners: true,
    periodAllowance: 100000,
    periodSpent: 0,
    periodRemaining: 100000,
    txCap: 50000,
    absoluteFeeCap: 5000,
    feerateCapSatVb: 10,
    ...over,
  }
}

describe('status identity binding', () => {
  it('accepts the requested vault id and rejects a wrong-vault response', () => {
    const first = requireStatusIdentity(sampleStatus())
    expect(first.vaultId).toBe(VAULT_ID)
    expect(() => requireStatusIdentity(sampleStatus(), 'tenant-b')).toThrow(/vault id/)
    expect(() => requireStatusIdentity(sampleStatus({ vaultId: 'tenant-b' }))).toThrow(/vault id/)
    expect(() => requireStatusIdentity(sampleStatus({ vaultId: 'tenant-b' }), VAULT_ID)).toThrow(/vault id/)
  })

  it('binds parseStatusJson to the expected vault', () => {
    const raw = JSON.stringify(sampleStatus({ vaultId: 'tenant-b' }))
    expect(parseStatusJson(raw, 'tenant-b').vaultId).toBe('tenant-b')
    expect(() => parseStatusJson(raw, VAULT_ID)).toThrow(/vault id/)
  })

  it('asks the authorizer for the selected vault id', () => {
    expect(vaultStatusPath()).toBe(`/v1/status?vault=${encodeURIComponent(VAULT_ID)}`)
    expect(vaultStatusPath('tenant-b')).toBe('/v1/status?vault=tenant-b')
    expect(() => vaultStatusPath('')).toThrow(/vault id required/)
    expect(() => requireStatusIdentity(sampleStatus(), '')).toThrow(/vault id required/)
  })

  it('does not treat vault id agreement as a deposit-address bind', () => {
    const swapped = sampleStatus({ operationalAddress: 'tb1pattacker' })
    expect(requireStatusIdentity(swapped).operationalAddress).toBe('tb1pattacker')
  })

  it('rejects a leftover v4 recovery key or a v3 template, and accepts v5', () => {
    expect(() => requireStatusIdentity(sampleStatus({ recoveryKeyPub: '02' + '11'.repeat(32) } as never))).toThrow(
      /template version/,
    )
    expect(() =>
      requireStatusIdentity(sampleStatus({ templateVersion: 'phone-direct-p256-routine-3of3-admin-2of2-v3' })),
    ).toThrow(/template version/)
    expect(
      requireStatusIdentity(sampleStatus({ templateVersion: V5_TEMPLATE, recoveryPub: '02' + '11'.repeat(32) }))
        .templateVersion,
    ).toBe(V5_TEMPLATE)
  })
})

describe('pingVaultService', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is online when public status answers this release', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              network: 'mutinynet',
              clientOrigin: 'https://arkade-vault-demo.vercel.app',
              rpId: 'arkade-vault-demo.vercel.app',
              templateVersion: V5_TEMPLATE,
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

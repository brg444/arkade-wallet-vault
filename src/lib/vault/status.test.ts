import { afterEach, describe, expect, it, vi } from 'vitest'
import { POLICY_VERSION } from './constants'
import { pinEnrolledStatus } from './pin'
import { SAVINGS_TEMPLATE } from './program/constants'
import {
  fetchPublicStatus,
  fetchVaultReadiness,
  fetchVaultStatus,
  parseStatusJson,
  pingVaultService,
  requireStatusIdentity,
  VaultReadinessResponseError,
  vaultStatusPath,
} from './status'
import type { VaultStatusWire } from './types'
import { CURRENT_SPENDING_POLICY_CAPABILITIES, defaultSpendingPolicy, spendingPolicyDigest } from './spendingPolicy'

const VAULT_ID = 'vault-test-current'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

type CompatibleStatusWire = VaultStatusWire & { recoveryPub?: string }

function sampleStatus(over: Partial<CompatibleStatusWire> = {}): CompatibleStatusWire {
  const spendingPolicy = defaultSpendingPolicy()
  return {
    enrolled: true,
    network: 'mutinynet',
    clientOrigin: 'https://vault.example',
    rpId: 'vault.example',
    vaultId: VAULT_ID,
    templateVersion: SAVINGS_TEMPLATE,
    policyVersion: POLICY_VERSION,
    protectionTier: 'standard',
    arkadeCosignerOrigin: 'https://mutinynet.arkade.sh',
    arkadeCosignerVersion: '0.4.65',
    savingsAddress: 'tb1ptest',
    savingsScript: '5120' + 'aa'.repeat(32),
    passkeyLoginAvailable: false,
    enrollmentMode: 'invite',
    periodAllowance: 100_000,
    periodSpent: 0,
    periodRemaining: 100_000,
    txCap: 50_000,
    absoluteFeeCap: 5_000,
    feerateCapSatVb: 10,
    spendingPolicy,
    spendingPolicyDigest: spendingPolicyDigest(spendingPolicy),
    vtxoVaultCosignerPub: '02' + '11'.repeat(32),
    vtxoExitDelay: 4608,
    vtxoExitDelayUnit: 'seconds',
    spendingArkAddress: 'tark1spending',
    spendingArkScript: '5120' + '22'.repeat(32),
    vtxoDelegatePub: '02' + '33'.repeat(32),
    vtxoBoardingActive: true,
    vtxoBoardingProgram: 'vault-board-v1',
    vtxoBoardingAddress: 'tb1pboarding',
    vtxoBoardingScript: '5120' + '44'.repeat(32),
    vtxoBoardingExitDelay: 604672,
    vtxoBoardingExitDelayUnit: 'seconds',
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

  it('keeps mainnet disabled until the named Vault Program is released for it', () => {
    expect(() => requireStatusIdentity(sampleStatus({ network: 'bitcoin' }), VAULT_ID)).toThrow(
      /unsupported Vault network/,
    )
  })

  it('requires the Savings descriptor but no retired Daily account', () => {
    expect(() => requireStatusIdentity(sampleStatus({ savingsScript: '' }), VAULT_ID)).toThrow(/Savings descriptor/)
    expect(requireStatusIdentity(sampleStatus(), VAULT_ID)).not.toHaveProperty('operationalAddress')
  })

  it('normalizes the server recoveryKeyPub field and rejects conflicting aliases', () => {
    const recovery = `02${'bb'.repeat(32)}`
    expect(
      requireStatusIdentity(sampleStatus({ protectionTier: 'advanced', recoveryKeyPub: recovery }), VAULT_ID),
    ).toMatchObject({
      recoveryPub: recovery,
      recoveryKeyPub: recovery,
    })
    expect(() =>
      requireStatusIdentity(
        sampleStatus({ protectionTier: 'advanced', recoveryKeyPub: recovery, recoveryPub: `03${'cc'.repeat(32)}` }),
        VAULT_ID,
      ),
    ).toThrow(/recovery key fields/)
  })

  it('requires the protection tier to match recovery-key presence', () => {
    const recovery = `02${'bb'.repeat(32)}`
    expect(() => requireStatusIdentity(sampleStatus({ protectionTier: 'advanced' }), VAULT_ID)).toThrow(/Advanced/)
    expect(() => requireStatusIdentity(sampleStatus({ recoveryKeyPub: recovery }), VAULT_ID)).toThrow(/Standard/)
    expect(() => requireStatusIdentity({ ...sampleStatus(), protectionTier: undefined } as never, VAULT_ID)).toThrow(
      /protection tier/,
    )
  })

  it('fails closed when a pinned enrolled vault is reported as unenrolled', async () => {
    pinEnrolledStatus(requireStatusIdentity(sampleStatus(), VAULT_ID))
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(sampleStatus({ enrolled: false })), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    await expect(fetchVaultStatus(undefined, VAULT_ID)).rejects.toThrow(/not enrolled/)
  })
})

describe('pingVaultService', () => {
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
              spendingPolicyCapabilities: CURRENT_SPENDING_POLICY_CAPABILITIES,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    await expect(pingVaultService()).resolves.toBe(true)
  })

  it('rejects a mainnet deployment before its Vault Program is released', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              network: 'bitcoin',
              clientOrigin: 'https://vault.example',
              rpId: 'vault.example',
              templateVersion: SAVINGS_TEMPLATE,
              policyVersion: POLICY_VERSION,
              enrollmentMode: 'invite',
              spendingPolicyCapabilities: CURRENT_SPENDING_POLICY_CAPABILITIES,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    await expect(fetchPublicStatus()).rejects.toThrow(/unsupported Vault network/)
    await expect(pingVaultService()).resolves.toBe(false)
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

describe('Vault readiness', () => {
  const ready = {
    ok: true,
    schema: 7,
    network: 'mutinynet',
    enrollTemplate: SAVINGS_TEMPLATE,
    arkadeOrigin: 'https://mutinynet.arkade.sh',
    arkadeVersion: '0.4.65',
  }

  it('accepts the current typed readiness response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(ready), { status: 200 })),
    )
    await expect(fetchVaultReadiness()).resolves.toEqual({ state: 'ready', status: ready })
  })

  it('keeps a structured 503 error out of the display state', async () => {
    const unavailable = { ...ready, ok: false, error: 'ledger unavailable' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(unavailable), { status: 503 })),
    )
    await expect(fetchVaultReadiness()).resolves.toEqual({ state: 'unavailable', status: unavailable })
  })

  it('rejects a malformed readiness body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    )
    await expect(fetchVaultReadiness()).rejects.toBeInstanceOf(VaultReadinessResponseError)
  })

  it('aborts a readiness request that exceeds its timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
          }),
      ),
    )
    await expect(fetchVaultReadiness(undefined, 1)).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('distinguishes a network failure from a structured unavailable response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(fetchVaultReadiness()).rejects.toBeInstanceOf(TypeError)
  })
})

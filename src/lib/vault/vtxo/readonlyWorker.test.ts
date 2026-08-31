import { ReadonlySingleKey } from '@arkade-os/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { VaultStatus } from '../types'
import { isVaultReadonlyUtxoUpdate, registerVaultReadonlyServiceWorker, vaultReadonlyIdentity } from './readonlyWorker'
import { vaultReadonlyUpdaterTag, vaultReadonlyWorkerScope } from './readonlyWorkerNames'

function activatedWorker(name: string) {
  return { name, state: 'activated' } as unknown as ServiceWorker
}

describe('readonly Vault service-worker isolation', () => {
  it('constructs only a public-key identity for the persistent worker', () => {
    const status = { phoneBip340Pub: `02${'11'.repeat(32)}` } as VaultStatus
    expect(vaultReadonlyIdentity(status)).toBeInstanceOf(ReadonlySingleKey)
  })

  it('keeps A → B → A registrations on their distinct scope and worker', async () => {
    const workers = new Map([
      [vaultReadonlyWorkerScope('vault-a'), activatedWorker('a')],
      [vaultReadonlyWorkerScope('vault-b'), activatedWorker('b')],
    ])
    const register = vi.fn(async (_path: string, options?: RegistrationOptions) => ({
      active: workers.get(String(options?.scope)),
      installing: null,
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
    }))
    const serviceWorkers = { register } as unknown as Pick<ServiceWorkerContainer, 'register'>

    const firstA = await registerVaultReadonlyServiceWorker('vault-a', serviceWorkers)
    const b = await registerVaultReadonlyServiceWorker('vault-b', serviceWorkers)
    const secondA = await registerVaultReadonlyServiceWorker('vault-a', serviceWorkers)

    expect((firstA.worker as unknown as { name: string }).name).toBe('a')
    expect((b.worker as unknown as { name: string }).name).toBe('b')
    expect(secondA.worker).toBe(firstA.worker)
    expect(register.mock.calls.map(([, options]) => options?.scope)).toEqual([
      vaultReadonlyWorkerScope('vault-a'),
      vaultReadonlyWorkerScope('vault-b'),
      vaultReadonlyWorkerScope('vault-a'),
    ])
    expect(register.mock.calls.every(([, options]) => options?.type === undefined)).toBe(true)
  })

  it('keeps simultaneous A/B registration and update tags disjoint', async () => {
    const register = vi.fn(async (_path: string, options?: RegistrationOptions) => ({
      active: activatedWorker(String(options?.scope)),
      installing: null,
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
    }))
    const serviceWorkers = { register } as unknown as Pick<ServiceWorkerContainer, 'register'>

    const [a, b] = await Promise.all([
      registerVaultReadonlyServiceWorker('vault-a', serviceWorkers),
      registerVaultReadonlyServiceWorker('vault-b', serviceWorkers),
    ])

    expect(a.worker).not.toBe(b.worker)
    const tagA = vaultReadonlyUpdaterTag('vault-a')
    const tagB = vaultReadonlyUpdaterTag('vault-b')
    expect(isVaultReadonlyUtxoUpdate({ tag: tagA, type: 'UTXO_UPDATE' }, tagA)).toBe(true)
    expect(isVaultReadonlyUtxoUpdate({ tag: tagA, type: 'UTXO_UPDATE' }, tagB)).toBe(false)
  })

  it('awaits an existing registration update before selecting its active worker', async () => {
    let finishUpdate!: () => void
    const update = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUpdate = resolve
        }),
    )
    const register = vi.fn().mockResolvedValue({
      active: activatedWorker('updated'),
      installing: null,
      waiting: null,
      update,
    })
    const pending = registerVaultReadonlyServiceWorker('vault-a', {
      register,
    } as unknown as Pick<ServiceWorkerContainer, 'register'>)

    await Promise.resolve()
    expect(update).toHaveBeenCalledTimes(1)
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    finishUpdate()
    await expect(pending).resolves.toMatchObject({ worker: { state: 'activated' } })
  })
})

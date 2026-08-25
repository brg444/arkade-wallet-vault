import { ReadonlySingleKey } from '@arkade-os/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { VaultStatus } from '../types'
import {
  createVaultLightningObserverScheduler,
  isolateVaultReadonlyBaselineContracts,
  isVaultReadonlyStateUpdate,
  registerVaultReadonlyServiceWorker,
  subscribeVaultLightningObserver,
  vaultReadonlyIdentity,
  vaultReadonlyRuntimeKey,
} from './readonlyWorker'
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
    expect(isVaultReadonlyStateUpdate({ tag: tagA, type: 'UTXO_UPDATE' }, tagA)).toBe(true)
    expect(isVaultReadonlyStateUpdate({ tag: tagA, type: 'VTXO_UPDATE' }, tagA)).toBe(true)
    expect(isVaultReadonlyStateUpdate({ tag: tagA, type: 'UTXO_UPDATE' }, tagB)).toBe(false)
  })

  it('serializes same-vault worker updates across simultaneous tabs', async () => {
    let tail = Promise.resolve()
    let activeUpdates = 0
    let maxActiveUpdates = 0
    const request = vi.fn(<T>(_name: string, _options: unknown, callback: (lock: unknown) => Promise<T>) => {
      const result = tail.then(() => callback({ held: true }))
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    })
    const update = vi.fn(async () => {
      activeUpdates += 1
      maxActiveUpdates = Math.max(maxActiveUpdates, activeUpdates)
      await Promise.resolve()
      activeUpdates -= 1
    })
    const register = vi.fn(async () => ({
      active: activatedWorker('shared'),
      installing: null,
      waiting: null,
      update,
    }))

    await Promise.all([
      registerVaultReadonlyServiceWorker('vault-a', { register } as never, { request } as never),
      registerVaultReadonlyServiceWorker('vault-a', { register } as never, { request } as never),
    ])

    expect(maxActiveUpdates).toBe(1)
    expect(request.mock.calls.map(([name]) => name)).toEqual([
      `arkade-vault-wallet-worker:${vaultReadonlyUpdaterTag('vault-a')}`,
      `arkade-vault-wallet-worker:${vaultReadonlyUpdaterTag('vault-a')}`,
    ])
  })

  it('recreates readonly state when a pinned deployment input changes', () => {
    const base = {
      enrolled: true,
      vaultId: 'vault-a',
      network: 'mutinynet',
      phoneBip340Pub: `02${'11'.repeat(32)}`,
      spendingArkScript: 'aa',
      spendingArkAddress: 'tark1spending',
      vtxoBoardingScript: 'bb',
      vtxoBoardingAddress: 'tb1pboarding',
    } as VaultStatus
    const key = vaultReadonlyRuntimeKey(base)
    for (const changed of [
      { network: 'bitcoin' },
      { phoneBip340Pub: `03${'22'.repeat(32)}` },
      { spendingArkScript: 'cc' },
      { spendingArkAddress: 'ark1other' },
      { vtxoBoardingScript: 'dd' },
      { vtxoBoardingAddress: 'bc1pother' },
    ]) {
      expect(vaultReadonlyRuntimeKey({ ...base, ...changed } as VaultStatus)).not.toBe(key)
    }
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

  it('retains an unused SDK default while keeping a coalesced boarding default active', async () => {
    const setContractState = vi.fn().mockResolvedValue(undefined)
    const setContractWatchState = vi.fn().mockResolvedValue(undefined)
    await isolateVaultReadonlyBaselineContracts(
      {
        getContracts: vi.fn().mockResolvedValue([
          {
            type: 'default',
            script: 'unused',
            address: 'unused',
            params: {},
            state: 'active',
            createdAt: 1,
          },
          {
            type: 'default',
            script: 'boarding',
            address: 'boarding',
            params: {},
            state: 'inactive',
            watch: 'retained',
            createdAt: 2,
          },
        ]),
        setContractState,
        setContractWatchState,
      },
      { vtxoBoardingScript: 'boarding' },
    )

    expect(setContractState.mock.calls).toEqual([
      ['unused', 'inactive'],
      ['boarding', 'active'],
    ])
    expect(setContractWatchState.mock.calls).toEqual([
      ['unused', 'retained'],
      ['boarding', 'watched'],
    ])
  })

  it('retains every baseline default while keeping a distinct boarding contract active', async () => {
    const setContractState = vi.fn().mockResolvedValue(undefined)
    const setContractWatchState = vi.fn().mockResolvedValue(undefined)
    await isolateVaultReadonlyBaselineContracts(
      {
        getContracts: vi.fn().mockResolvedValue([
          {
            type: 'default',
            script: 'unused',
            address: 'unused',
            params: {},
            state: 'active',
            createdAt: 1,
          },
          {
            type: 'boarding',
            script: 'boarding',
            address: 'boarding',
            params: {},
            state: 'active',
            createdAt: 2,
          },
        ]),
        setContractState,
        setContractWatchState,
      },
      { vtxoBoardingScript: 'boarding' },
    )

    expect(setContractState).toHaveBeenCalledExactlyOnceWith('unused', 'inactive')
    expect(setContractWatchState).toHaveBeenCalledExactlyOnceWith('unused', 'retained')
  })

  it('fails closed when the SDK default contracts omit the pinned boarding script', async () => {
    await expect(
      isolateVaultReadonlyBaselineContracts(
        {
          getContracts: vi.fn().mockResolvedValue([]),
          setContractState: vi.fn(),
          setContractWatchState: vi.fn(),
        },
        { vtxoBoardingScript: 'boarding' },
      ),
    ).rejects.toThrow(/pinned boarding contract/)
  })

  it('wakes readonly history when the package observer changes a swap state', () => {
    const callbacks: (() => void)[] = []
    const unsubscribers = [vi.fn(), vi.fn(), vi.fn()]
    const manager = {
      onSwapUpdate: vi.fn((callback: () => void) => {
        callbacks.push(callback)
        return unsubscribers[0]
      }),
      onSwapCompleted: vi.fn((callback: () => void) => {
        callbacks.push(callback)
        return unsubscribers[1]
      }),
      onSwapFailed: vi.fn((callback: () => void) => {
        callbacks.push(callback)
        return unsubscribers[2]
      }),
    }
    const refresh = vi.fn()
    const unsubscribe = subscribeVaultLightningObserver(manager as never, refresh)

    callbacks[0]()
    callbacks[1]()
    callbacks[2]()
    expect(refresh).toHaveBeenCalledTimes(3)

    unsubscribe()
    expect(unsubscribers.every((remove) => remove.mock.calls.length === 1)).toBe(true)
  })

  it('coalesces visible observer wakes and disposes every timer', async () => {
    vi.useFakeTimers()
    try {
      const run = vi.fn(async () => undefined)
      const scheduler = createVaultLightningObserverScheduler(run, {
        intervalMs: 1_000,
        debounceMs: 10,
        isVisible: () => true,
      })

      scheduler.schedule()
      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(10)
      expect(run).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(1_000)
      expect(run).toHaveBeenCalledTimes(2)

      await scheduler.dispose()
      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(run).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drains an in-flight observer pass and suppresses its late notification on disposal', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const notify = vi.fn()
    let scheduler: ReturnType<typeof createVaultLightningObserverScheduler>
    scheduler = createVaultLightningObserverScheduler(
      async () => {
        await gate
        if (!scheduler.isDisposed()) notify()
      },
      { isVisible: () => true },
    )

    const refresh = scheduler.refresh()
    let disposed = false
    const disposal = scheduler.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)

    release()
    await Promise.all([refresh, disposal])
    expect(disposed).toBe(true)
    expect(notify).not.toHaveBeenCalled()
  })
})

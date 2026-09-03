import { ArkAddress, ServiceWorkerWallet } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { describe, expect, it, vi } from 'vitest'
import type { VaultStatus } from '../types'
import {
  createVaultLightningObserverScheduler,
  isVaultWalletStateUpdate,
  registerVaultWalletServiceWorker,
  scheduleVaultBoardingSettlement,
  shutdownVaultWalletWorker,
  subscribeVaultLightningObserver,
  vaultBoardingSettleParams,
  vaultWalletRuntimeKey,
} from './walletWorker'
import { vaultWalletUpdaterTag, vaultWalletWorkerPath, vaultWalletWorkerScope } from './walletWorkerNames'

function activatedWorker(name: string) {
  return { name, state: 'activated' } as unknown as ServiceWorker
}

describe('Vault service-worker isolation', () => {
  it('deduplicates page-owned boarding requests while the worker settlement is pending', async () => {
    let finish!: (txid: string) => void
    const settle = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    const listener = vi.fn()
    const current = {
      listeners: new Set([listener]),
      boardingSettle: undefined,
    }

    const first = scheduleVaultBoardingSettlement(current, settle)
    const duplicate = scheduleVaultBoardingSettlement(current, settle)

    expect(duplicate).toBe(first)
    expect(settle).toHaveBeenCalledTimes(1)
    finish('aa'.repeat(32))
    await first
    expect(listener).toHaveBeenCalledTimes(1)

    const next = scheduleVaultBoardingSettlement(current, settle)
    expect(settle).toHaveBeenCalledTimes(2)
    finish('bb'.repeat(32))
    await next
  })

  it('settles exactly one confirmed boarding input to the fixed Spending address', async () => {
    const address = new ArkAddress(hex.decode('11'.repeat(32)), hex.decode('22'.repeat(32)), 'tark').encode()
    const provider = {
      getInfo: vi.fn().mockResolvedValue({
        fees: { intentFee: { onchainInput: '1.0', offchainOutput: '2.0' } },
        vtxoMaxAmount: -1n,
      }),
    }
    const confirmed = {
      txid: 'aa'.repeat(32),
      vout: 1,
      value: 100_000,
      status: { confirmed: true },
    }
    const params = await vaultBoardingSettleParams(
      [
        { txid: '00'.repeat(32), vout: 0, value: 200_000, status: { confirmed: false } },
        { txid: '01'.repeat(32), vout: 0, value: 1, status: { confirmed: true } },
        confirmed,
        { txid: 'bb'.repeat(32), vout: 0, value: 300_000, status: { confirmed: true } },
      ] as never,
      address,
      provider as never,
    )

    expect(params).toEqual({
      inputs: [confirmed],
      outputs: [{ address, amount: 99_997n }],
    })
  })

  it('keeps A → B → A registrations on their distinct scope and worker', async () => {
    const stop = vi.spyOn(ServiceWorkerWallet, 'stop')
    const workers = new Map([
      [vaultWalletWorkerScope('vault-a'), activatedWorker('a')],
      [vaultWalletWorkerScope('vault-b'), activatedWorker('b')],
    ])
    const register = vi.fn(async (_path: string, options?: RegistrationOptions) => ({
      active: workers.get(String(options?.scope)),
      installing: null,
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
    }))
    const serviceWorkers = { register } as unknown as Pick<ServiceWorkerContainer, 'register'>

    const firstA = await registerVaultWalletServiceWorker('vault-a', serviceWorkers)
    const b = await registerVaultWalletServiceWorker('vault-b', serviceWorkers)
    const secondA = await registerVaultWalletServiceWorker('vault-a', serviceWorkers)

    expect((firstA.worker as unknown as { name: string }).name).toBe('a')
    expect((b.worker as unknown as { name: string }).name).toBe('b')
    expect(secondA.worker).toBe(firstA.worker)
    expect(register.mock.calls.map(([, options]) => options?.scope)).toEqual([
      vaultWalletWorkerScope('vault-a'),
      vaultWalletWorkerScope('vault-b'),
      vaultWalletWorkerScope('vault-a'),
    ])
    expect(register.mock.calls.every(([, options]) => options?.type === undefined)).toBe(true)
    expect(stop).not.toHaveBeenCalled()
    stop.mockRestore()
  })

  it('stops an initialized worker after reload before unregistering it', async () => {
    const worker = activatedWorker('wallet')
    const unregister = vi.fn().mockResolvedValue(true)
    const registration = { active: worker, waiting: null, installing: null, unregister }
    const previous = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue(registration) },
    })
    const stop = vi.spyOn(ServiceWorkerWallet, 'stop').mockResolvedValue(undefined)

    try {
      await shutdownVaultWalletWorker('vault-reloaded')
      expect(stop).toHaveBeenCalledWith(worker, 60_000)
      expect(stop.mock.invocationCallOrder[0]).toBeLessThan(unregister.mock.invocationCallOrder[0])
    } finally {
      stop.mockRestore()
      if (previous) Object.defineProperty(navigator, 'serviceWorker', previous)
      else delete (navigator as { serviceWorker?: unknown }).serviceWorker
    }
  })

  it('retains the registration when acknowledged worker teardown fails', async () => {
    const worker = activatedWorker('wallet')
    const unregister = vi.fn().mockResolvedValue(true)
    const previous = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue({ active: worker, waiting: null, installing: null, unregister }),
      },
    })
    const stop = vi.spyOn(ServiceWorkerWallet, 'stop').mockRejectedValue(new Error('worker still draining'))

    try {
      await expect(shutdownVaultWalletWorker('vault-reloaded')).rejects.toThrow('worker still draining')
      expect(unregister).not.toHaveBeenCalled()
    } finally {
      stop.mockRestore()
      if (previous) Object.defineProperty(navigator, 'serviceWorker', previous)
      else delete (navigator as { serviceWorker?: unknown }).serviceWorker
    }
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
      registerVaultWalletServiceWorker('vault-a', serviceWorkers),
      registerVaultWalletServiceWorker('vault-b', serviceWorkers),
    ])

    expect(a.worker).not.toBe(b.worker)
    const tagA = vaultWalletUpdaterTag('vault-a')
    const tagB = vaultWalletUpdaterTag('vault-b')
    expect(isVaultWalletStateUpdate({ tag: tagA, type: 'UTXO_UPDATE' }, tagA)).toBe(true)
    expect(isVaultWalletStateUpdate({ tag: tagA, type: 'VTXO_UPDATE' }, tagA)).toBe(true)
    expect(isVaultWalletStateUpdate({ tag: tagA, type: 'UTXO_UPDATE' }, tagB)).toBe(false)
  })

  it('uses the sole wallet worker for the scoped registration', async () => {
    const register = vi.fn(async () => ({
      active: activatedWorker('wallet'),
      installing: null,
      waiting: null,
      update: vi.fn().mockResolvedValue(undefined),
    }))
    await registerVaultWalletServiceWorker('vault-a', {
      register,
    } as unknown as Pick<ServiceWorkerContainer, 'register'>)
    expect(register).toHaveBeenCalledWith(vaultWalletWorkerPath('vault-a'), {
      scope: vaultWalletWorkerScope('vault-a'),
      updateViaCache: 'none',
    })
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
      registerVaultWalletServiceWorker('vault-a', { register } as never, { request } as never),
      registerVaultWalletServiceWorker('vault-a', { register } as never, { request } as never),
    ])

    expect(maxActiveUpdates).toBe(1)
    expect(request.mock.calls.map(([name]) => name)).toEqual([
      `arkade-vault-wallet-worker:${vaultWalletUpdaterTag('vault-a')}`,
      `arkade-vault-wallet-worker:${vaultWalletUpdaterTag('vault-a')}`,
    ])
  })

  it('recreates wallet state when a pinned deployment input changes', () => {
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
    const key = vaultWalletRuntimeKey(base)
    for (const changed of [
      { network: 'bitcoin' },
      { phoneBip340Pub: `03${'22'.repeat(32)}` },
      { spendingArkScript: 'cc' },
      { spendingArkAddress: 'ark1other' },
      { vtxoBoardingScript: 'dd' },
      { vtxoBoardingAddress: 'bc1pother' },
    ]) {
      expect(vaultWalletRuntimeKey({ ...base, ...changed } as VaultStatus)).not.toBe(key)
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
    const pending = registerVaultWalletServiceWorker('vault-a', {
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

  it('wakes history when the package observer changes a swap state', () => {
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

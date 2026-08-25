import {
  IndexedDBContractRepository,
  IndexedDBWalletRepository,
  ReadonlySingleKey,
  RestIndexerProvider,
  ServiceWorkerReadonlyWallet,
  hasTerminalSpend,
  type IContractManager,
} from '@arkade-os/sdk'
import {
  IndexedDbAssetSwapRepository,
  rfqSwapActivityInputs,
  swapActivityResolver,
  type RfqSwapManager,
} from '@arkade-os/swap'
import { hex } from '@scure/base'
import { consoleError } from '../../logs'
import { historyFromSdkActivities, type VaultHistoryItem } from '../history'
import { tryVaultLightningLifecycleLock } from '../lightningLock'
import {
  createVaultLightningObserver,
  listVaultLightningActivityRecords,
  maintainVaultLightningObserver,
  vaultLightningSwapStorageName,
} from '../lightningLifecycle'
import type { VaultStatus } from '../types'
import { registerVaultPolicyV1ContractHandler, vaultPolicyV1Contract } from './contractHandler'
import { browserVaultLockManager, type VaultLockManager } from './lock'
import {
  vaultReadonlyUpdaterTag,
  vaultReadonlyWalletDatabase,
  vaultReadonlyWorkerPath,
  vaultReadonlyWorkerScope,
} from './readonlyWorkerNames'
import { vaultArkServer, vaultPolicyV1ScriptFromStatus } from './spend'

type ReadonlyRuntime = {
  key: string
  vaultId: string
  registration: ServiceWorkerRegistration
  wallet: ServiceWorkerReadonlyWallet
  walletRepository: IndexedDBWalletRepository
  contractRepository: IndexedDBContractRepository
  swapRepository: IndexedDbAssetSwapRepository
  swapManager: RfqSwapManager
  listeners: Set<() => void>
  unsubscribeContract: () => void
  unsubscribeSwap: () => void
  onWorkerMessage: (event: MessageEvent) => void
  lightningObserver: VaultLightningObserverScheduler
}

let runtime: ReadonlyRuntime | undefined
let initialization: Promise<ReadonlyRuntime> | undefined

const VAULT_LIGHTNING_OBSERVER_INTERVAL_MS = 15_000

export interface VaultLightningObserverScheduler {
  refresh: () => Promise<void>
  schedule: () => void
  isDisposed: () => boolean
  dispose: () => Promise<void>
}

/** Visible, coalesced foreground polling with deterministic resource cleanup. */
export function createVaultLightningObserverScheduler(
  run: () => Promise<void>,
  options: {
    intervalMs?: number
    debounceMs?: number
    isVisible?: () => boolean
  } = {},
): VaultLightningObserverScheduler {
  const intervalMs = options.intervalMs ?? VAULT_LIGHTNING_OBSERVER_INTERVAL_MS
  const debounceMs = options.debounceMs ?? 200
  const isVisible = options.isVisible ?? (() => document.visibilityState !== 'hidden')
  let activeRun: Promise<void> | undefined
  let disposed = false
  let scheduled = 0
  const refresh = () => {
    if (disposed || activeRun || !isVisible()) return activeRun || Promise.resolve()
    const current = run()
    const tracked = current.finally(() => {
      if (activeRun === tracked) activeRun = undefined
    })
    activeRun = tracked
    return activeRun
  }
  const schedule = () => {
    if (disposed || activeRun || scheduled || !isVisible()) return
    scheduled = window.setTimeout(() => {
      scheduled = 0
      void refresh().catch((error) => consoleError(error, 'Lightning observer refresh'))
    }, debounceMs)
  }
  const interval = window.setInterval(schedule, intervalMs)
  return {
    refresh,
    schedule,
    isDisposed: () => disposed,
    dispose: async () => {
      disposed = true
      window.clearInterval(interval)
      window.clearTimeout(scheduled)
      scheduled = 0
      await Promise.allSettled(activeRun ? [activeRun] : [])
    },
  }
}

export function isVaultReadonlyStateUpdate(message: unknown, updaterTag: string): boolean {
  const value = message as { tag?: string; type?: string } | null
  return value?.tag === updaterTag && (value.type === 'VTXO_UPDATE' || value.type === 'UTXO_UPDATE')
}

export function subscribeVaultLightningObserver(
  manager: Pick<RfqSwapManager, 'onSwapUpdate' | 'onSwapCompleted' | 'onSwapFailed'>,
  listener: () => void,
): () => void {
  const unsubscribers = [
    manager.onSwapUpdate(listener),
    manager.onSwapCompleted(listener),
    manager.onSwapFailed(listener),
  ]
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
}

export async function waitForVaultWorkerActivation(
  registration: Pick<ServiceWorkerRegistration, 'active' | 'installing' | 'waiting'>,
  timeoutMs = 15_000,
): Promise<ServiceWorker> {
  const worker = registration.installing || registration.waiting || registration.active
  if (!worker) throw new Error('Vault readonly worker did not install')
  if (worker.state === 'activated') return worker
  return new Promise<ServiceWorker>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener('statechange', onStateChange)
      reject(new Error('Vault readonly worker activation timed out'))
    }, timeoutMs)
    const onStateChange = () => {
      if (worker.state === 'activated') {
        window.clearTimeout(timeout)
        worker.removeEventListener('statechange', onStateChange)
        resolve(worker)
      } else if (worker.state === 'redundant') {
        window.clearTimeout(timeout)
        worker.removeEventListener('statechange', onStateChange)
        reject(new Error('Vault readonly worker became redundant before activation'))
      }
    }
    worker.addEventListener('statechange', onStateChange)
  })
}

export async function registerVaultReadonlyServiceWorker(
  vaultId: string,
  serviceWorkers: Pick<ServiceWorkerContainer, 'register'> = navigator.serviceWorker,
  locks: VaultLockManager | undefined = browserVaultLockManager(),
): Promise<{ registration: ServiceWorkerRegistration; worker: ServiceWorker }> {
  const register = async () => {
    const registration = await serviceWorkers.register(vaultReadonlyWorkerPath(vaultId), {
      scope: vaultReadonlyWorkerScope(vaultId),
      updateViaCache: 'none',
    })
    await registration.update()
    return { registration, worker: await waitForVaultWorkerActivation(registration) }
  }
  if (!locks) return register()
  return locks.request(
    `arkade-vault-wallet-worker:${vaultReadonlyUpdaterTag(vaultId)}`,
    { mode: 'exclusive' },
    async (lock) => {
      if (!lock) throw new Error('Web Locks API returned no Vault wallet worker lock')
      return register()
    },
  )
}

function compressedPhonePublicKey(status: VaultStatus): Uint8Array {
  let key: Uint8Array
  try {
    key = hex.decode(String(status.phoneBip340Pub || ''))
  } catch {
    throw new Error('Phone public key is not hex')
  }
  if (key.length !== 33 || (key[0] !== 2 && key[0] !== 3)) {
    throw new Error('Phone public key must be compressed')
  }
  return key
}

export function vaultReadonlyIdentity(status: VaultStatus) {
  return ReadonlySingleKey.fromPublicKey(compressedPhonePublicKey(status))
}

export function vaultReadonlyRuntimeKey(status: VaultStatus) {
  if (!status.enrolled || !status.vaultId) throw new Error('Enrolled vault required for VTXO state')
  return JSON.stringify([
    status.vaultId,
    status.network,
    String(status.phoneBip340Pub || '').toLowerCase(),
    String(status.spendingArkScript || '').toLowerCase(),
    String(status.spendingArkAddress || ''),
    String(status.vtxoBoardingScript || '').toLowerCase(),
    String(status.vtxoBoardingAddress || ''),
    vaultArkServer(),
  ])
}

function contractParams(status: VaultStatus) {
  const script = vaultPolicyV1ScriptFromStatus(status)
  return vaultPolicyV1Contract(script, String(status.spendingArkAddress || ''))
}

async function disposeRuntime(current: ReadonlyRuntime | undefined) {
  if (!current) return
  current.unsubscribeContract()
  current.unsubscribeSwap()
  navigator.serviceWorker.removeEventListener('message', current.onWorkerMessage)
  await current.lightningObserver.dispose()
  await current.swapManager.stop().catch(() => undefined)
  await Promise.allSettled([
    current.walletRepository[Symbol.asyncDispose](),
    current.contractRepository[Symbol.asyncDispose](),
    current.swapRepository[Symbol.asyncDispose](),
  ])
}

/**
 * The SDK creates a baseline default contract for its public identity. Vault
 * Spending must never watch or display that ordinary phone+Operator address.
 * When the SDK default script is exactly the pinned boarding script, however,
 * it is the real boarding destination and remains active and watched.
 */
export async function isolateVaultReadonlyBaselineContracts(
  manager: Pick<IContractManager, 'getContracts' | 'setContractState' | 'setContractWatchState'>,
  status: Pick<VaultStatus, 'vtxoBoardingScript'>,
): Promise<void> {
  const boardingScript = String(status.vtxoBoardingScript || '').toLowerCase()
  if (!boardingScript) throw new Error('Pinned boarding script required for readonly wallet state')
  const contracts = await manager.getContracts()
  const boardingContract = contracts.find((contract) => contract.script.toLowerCase() === boardingScript)
  if (!boardingContract) {
    throw new Error('Readonly SDK worker did not register the pinned boarding contract')
  }
  for (const contract of contracts.filter((candidate) => candidate.type === 'default')) {
    if (contract.script.toLowerCase() === boardingScript) continue
    if (contract.state !== 'inactive') await manager.setContractState(contract.script, 'inactive')
    if ((contract.watch || 'watched') !== 'retained') {
      await manager.setContractWatchState(contract.script, 'retained')
    }
  }
  if (boardingContract.state !== 'active') await manager.setContractState(boardingContract.script, 'active')
  if ((boardingContract.watch || 'watched') !== 'watched') {
    await manager.setContractWatchState(boardingContract.script, 'watched')
  }
}

async function createRuntime(status: VaultStatus): Promise<ReadonlyRuntime> {
  registerVaultPolicyV1ContractHandler()
  const key = vaultReadonlyRuntimeKey(status)
  const walletDatabase = vaultReadonlyWalletDatabase(status.vaultId)
  const walletRepository = new IndexedDBWalletRepository(walletDatabase)
  const contractRepository = new IndexedDBContractRepository(walletDatabase)
  const swapRepository = new IndexedDbAssetSwapRepository(vaultLightningSwapStorageName(status.vaultId))
  let swapManager: RfqSwapManager | undefined
  try {
    const { registration, worker: serviceWorker } = await registerVaultReadonlyServiceWorker(status.vaultId)
    const updaterTag = vaultReadonlyUpdaterTag(status.vaultId)
    const wallet = await ServiceWorkerReadonlyWallet.create({
      serviceWorker,
      identity: vaultReadonlyIdentity(status),
      arkServerUrl: vaultArkServer(),
      esploraUrl: '/esplora',
      walletMode: 'static',
      settlementConfig: false,
      walletUpdaterTag: updaterTag,
      storage: { walletRepository, contractRepository },
    })
    if ((await wallet.getBoardingAddress()) !== status.vtxoBoardingAddress) {
      throw new Error('Readonly SDK worker derived a different boarding address')
    }
    const manager = await wallet.getContractManager()
    await isolateVaultReadonlyBaselineContracts(manager, status)
    const contract = await manager.createContract(contractParams(status))
    if (contract.script !== String(status.spendingArkScript || '').toLowerCase()) {
      throw new Error('Readonly SDK worker registered a different Spending contract')
    }
    if (contract.state !== 'active') await manager.setContractState(contract.script, 'active')
    if ((contract.watch || 'watched') !== 'watched') {
      await manager.setContractWatchState(contract.script, 'watched')
    }
    const activityIndexer = new RestIndexerProvider(vaultArkServer())
    wallet.activity.use(
      swapActivityResolver({
        listSwaps: () => rfqSwapActivityInputs({ repository: swapRepository, indexer: activityIndexer }),
      }),
    )

    const activeSwapManager = createVaultLightningObserver({
      contracts: manager,
      indexer: activityIndexer,
      repository: swapRepository,
    })
    swapManager = activeSwapManager
    const maintainLightning = () =>
      maintainVaultLightningObserver({
        manager: activeSwapManager,
        contracts: manager,
        indexer: activityIndexer,
        repository: swapRepository,
      })
    const logMaintenanceFailures = (result: Awaited<ReturnType<typeof maintainLightning>>) => {
      for (const failure of result.restoreFailures) {
        consoleError(failure.error, `Lightning swap ${failure.rfqId} restore failed`)
      }
      for (const failure of result.retirementFailures) {
        consoleError(failure.error, `Lightning swap ${failure.rfqId} contract retirement failed`)
      }
    }
    try {
      const initialMaintenance = await tryVaultLightningLifecycleLock(status.vaultId, maintainLightning)
      if (initialMaintenance.held) logMaintenanceFailures(initialMaintenance.value)
    } catch (error) {
      // Lightning observation is auxiliary to the readonly Spending state
      // plane. A busy/unavailable observer is retried by focus and the bounded
      // visible timer; it must not strand Home balance initialization.
      consoleError(error, 'Lightning observer initial refresh')
    }

    const listeners = new Set<() => void>()
    const notify = () => listeners.forEach((listener) => listener())
    let lightningObserver: VaultLightningObserverScheduler
    lightningObserver = createVaultLightningObserverScheduler(async () => {
      const attempt = await tryVaultLightningLifecycleLock(status.vaultId, maintainLightning)
      if (!attempt.held) return
      logMaintenanceFailures(attempt.value)
      if (!lightningObserver.isDisposed()) notify()
    })
    const unsubscribeContract = manager.onContractEvent(() => {
      notify()
      lightningObserver.schedule()
    })
    const unsubscribeSwap = subscribeVaultLightningObserver(activeSwapManager, () => {
      notify()
      lightningObserver.schedule()
    })
    const onWorkerMessage = (event: MessageEvent) => {
      if (!isVaultReadonlyStateUpdate(event.data, updaterTag)) return
      notify()
      lightningObserver.schedule()
    }
    navigator.serviceWorker.addEventListener('message', onWorkerMessage)
    return {
      key,
      vaultId: status.vaultId,
      registration,
      wallet,
      walletRepository,
      contractRepository,
      swapRepository,
      swapManager: activeSwapManager,
      listeners,
      unsubscribeContract,
      unsubscribeSwap,
      onWorkerMessage,
      lightningObserver,
    }
  } catch (error) {
    await swapManager?.stop().catch(() => undefined)
    await Promise.allSettled([
      walletRepository[Symbol.asyncDispose](),
      contractRepository[Symbol.asyncDispose](),
      swapRepository[Symbol.asyncDispose](),
    ])
    throw error
  }
}

export interface VaultReadonlyStateSession {
  wallet: ServiceWorkerReadonlyWallet
  contracts: IContractManager
  swapRepository: IndexedDbAssetSwapRepository
  swapManager: RfqSwapManager
}

export async function withVaultReadonlyState<T>(
  status: VaultStatus,
  run: (session: VaultReadonlyStateSession) => Promise<T>,
): Promise<T> {
  const current = await ensureVaultReadonlyWorker(status)
  return run({
    wallet: current.wallet,
    contracts: await current.wallet.getContractManager(),
    swapRepository: current.swapRepository,
    swapManager: current.swapManager,
  })
}

export async function withActiveVaultReadonlyState<T>(
  vaultId: string,
  run: (session: VaultReadonlyStateSession) => Promise<T>,
): Promise<T> {
  const id = String(vaultId || '').trim()
  if (!id || runtime?.vaultId !== id) throw new Error('Vault wallet state is not ready for this vault')
  return run({
    wallet: runtime.wallet,
    contracts: await runtime.wallet.getContractManager(),
    swapRepository: runtime.swapRepository,
    swapManager: runtime.swapManager,
  })
}

export async function ensureVaultReadonlyWorker(status: VaultStatus): Promise<ReadonlyRuntime> {
  const key = vaultReadonlyRuntimeKey(status)
  if (runtime?.key === key) return runtime
  if (initialization) {
    const pending = await initialization
    if (pending.key === key) return pending
  }
  initialization = (async () => {
    if (runtime?.key === key) return runtime
    const previous = runtime
    runtime = undefined
    await disposeRuntime(previous)
    const next = await createRuntime(status)
    runtime = next
    return next
  })()
  try {
    return await initialization
  } finally {
    initialization = undefined
  }
}

export function subscribeVaultReadonlyEvents(status: VaultStatus, listener: () => void): () => void {
  let active = true
  let current: ReadonlyRuntime | undefined
  void ensureVaultReadonlyWorker(status)
    .then((next) => {
      if (!active) return
      current = next
      current.listeners.add(listener)
    })
    .catch(() => undefined)
  return () => {
    active = false
    current?.listeners.delete(listener)
  }
}

export async function reloadVaultReadonlyWorker(status: VaultStatus) {
  const current = await ensureVaultReadonlyWorker(status)
  await current.lightningObserver.refresh()
  await current.wallet.reload()
}

export interface VaultReadonlyVtxoSnapshot {
  balance: number
  commitmentIds?: string[]
  history: VaultHistoryItem[]
}

export async function fetchVaultReadonlyVtxoSnapshot(status: VaultStatus): Promise<VaultReadonlyVtxoSnapshot> {
  const current = await ensureVaultReadonlyWorker(status)
  const manager = await current.wallet.getContractManager()
  const script = String(status.spendingArkScript || '').toLowerCase()
  const contracts = await manager.getContractsWithVtxos({ script })
  const vtxos = contracts.flatMap((contract) => contract.vtxos)
  const commitmentIds = new Set<string>()
  for (const vtxo of vtxos) {
    commitmentIds.add(vtxo.txid)
    if (vtxo.arkTxId) commitmentIds.add(vtxo.arkTxId)
    for (const txid of vtxo.commitmentTxIds || []) commitmentIds.add(txid)
  }
  const [activities, swapRecords, lightningRecords] = await Promise.all([
    current.wallet.getActivityHistory(),
    current.swapRepository.getAllRfqSwaps(),
    listVaultLightningActivityRecords(current.swapRepository),
  ])
  const lightningRfqIds = new Set(
    swapRecords.filter((record) => record.kind === 'lightning_send').map((record) => record.rfqId),
  )
  return {
    balance: vtxos.filter((vtxo) => !hasTerminalSpend(vtxo)).reduce((sum, vtxo) => sum + vtxo.value, 0),
    commitmentIds: [...commitmentIds],
    history: historyFromSdkActivities(activities, { vaultTxids: commitmentIds, lightningRfqIds }, lightningRecords),
  }
}

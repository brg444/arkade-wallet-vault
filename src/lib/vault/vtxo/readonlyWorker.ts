import {
  IndexedDBContractRepository,
  IndexedDBWalletRepository,
  ReadonlySingleKey,
  RestIndexerProvider,
  ServiceWorkerReadonlyWallet,
  hasTerminalSpend,
} from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { historyFromVtxos, type VaultHistoryItem } from '../history'
import type { VaultStatus } from '../types'
import { registerVaultPolicyV1ContractHandler, vaultPolicyV1Contract } from './contractHandler'
import {
  vaultReadonlyUpdaterTag,
  vaultReadonlyWalletDatabase,
  vaultReadonlyWorkerPath,
  vaultReadonlyWorkerScope,
} from './readonlyWorkerNames'
import { fetchMissingVtxoCreatedAt, vaultArkServer, vaultPolicyV1ScriptFromStatus, vaultVtxoHistoryCoin } from './spend'

type ReadonlyRuntime = {
  key: string
  registration: ServiceWorkerRegistration
  wallet: ServiceWorkerReadonlyWallet
  walletRepository: IndexedDBWalletRepository
  contractRepository: IndexedDBContractRepository
  listeners: Set<() => void>
  unsubscribeContract: () => void
  onWorkerMessage: (event: MessageEvent) => void
}

let runtime: ReadonlyRuntime | undefined
let initialization: Promise<ReadonlyRuntime> | undefined

export function isVaultReadonlyUtxoUpdate(message: unknown, updaterTag: string): boolean {
  const value = message as { tag?: string; type?: string } | null
  return value?.tag === updaterTag && value.type === 'UTXO_UPDATE'
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
): Promise<{ registration: ServiceWorkerRegistration; worker: ServiceWorker }> {
  const registration = await serviceWorkers.register(vaultReadonlyWorkerPath(vaultId), {
    scope: vaultReadonlyWorkerScope(vaultId),
    updateViaCache: 'none',
  })
  await registration.update()
  return { registration, worker: await waitForVaultWorkerActivation(registration) }
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

function runtimeKey(status: VaultStatus) {
  if (!status.enrolled || !status.vaultId) throw new Error('Enrolled vault required for VTXO state')
  return `${status.vaultId}:${String(status.phoneBip340Pub || '').toLowerCase()}:${String(
    status.spendingArkScript || '',
  ).toLowerCase()}`
}

function contractParams(status: VaultStatus) {
  const script = vaultPolicyV1ScriptFromStatus(status)
  return vaultPolicyV1Contract(script, String(status.spendingArkAddress || ''))
}

async function disposeRuntime(current: ReadonlyRuntime | undefined) {
  if (!current) return
  current.unsubscribeContract()
  navigator.serviceWorker.removeEventListener('message', current.onWorkerMessage)
  await Promise.allSettled([
    current.walletRepository[Symbol.asyncDispose](),
    current.contractRepository[Symbol.asyncDispose](),
  ])
}

async function createRuntime(status: VaultStatus): Promise<ReadonlyRuntime> {
  registerVaultPolicyV1ContractHandler()
  const key = runtimeKey(status)
  const walletDatabase = vaultReadonlyWalletDatabase(status.vaultId)
  const walletRepository = new IndexedDBWalletRepository(walletDatabase)
  const contractRepository = new IndexedDBContractRepository(walletDatabase)
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
    const contract = await manager.createContract(contractParams(status))
    if (contract.script !== String(status.spendingArkScript || '').toLowerCase()) {
      throw new Error('Readonly SDK worker registered a different Spending contract')
    }

    const listeners = new Set<() => void>()
    const notify = () => listeners.forEach((listener) => listener())
    const unsubscribeContract = manager.onContractEvent(notify)
    const onWorkerMessage = (event: MessageEvent) => {
      if (isVaultReadonlyUtxoUpdate(event.data, updaterTag)) notify()
    }
    navigator.serviceWorker.addEventListener('message', onWorkerMessage)
    return {
      key,
      registration,
      wallet,
      walletRepository,
      contractRepository,
      listeners,
      unsubscribeContract,
      onWorkerMessage,
    }
  } catch (error) {
    await Promise.allSettled([walletRepository[Symbol.asyncDispose](), contractRepository[Symbol.asyncDispose]()])
    throw error
  }
}

export async function ensureVaultReadonlyWorker(status: VaultStatus): Promise<ReadonlyRuntime> {
  const key = runtimeKey(status)
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
  const resolvedCreatedAt = await fetchMissingVtxoCreatedAt(new RestIndexerProvider(vaultArkServer()), vtxos)
  const commitmentIds = new Set<string>()
  for (const vtxo of vtxos) {
    commitmentIds.add(vtxo.txid)
    if (vtxo.arkTxId) commitmentIds.add(vtxo.arkTxId)
    for (const txid of vtxo.commitmentTxIds || []) commitmentIds.add(txid)
  }
  return {
    balance: vtxos.filter((vtxo) => !hasTerminalSpend(vtxo)).reduce((sum, vtxo) => sum + vtxo.value, 0),
    commitmentIds: [...commitmentIds],
    history: historyFromVtxos(vtxos.map(vaultVtxoHistoryCoin), 'spend', resolvedCreatedAt),
  }
}

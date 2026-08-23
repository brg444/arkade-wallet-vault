import {
  DefaultVtxo,
  Estimator,
  IndexedDBContractRepository,
  IndexedDBIntentRepository,
  IndexedDBWalletRepository,
  RestArkProvider,
  RestIndexerProvider,
  SingleKey,
  Wallet,
  type ExtendedCoin,
} from '@arkade-os/sdk'
import { hex } from '@scure/base'
import type { VaultStatus } from '../types'
import { vaultAddressNetwork } from '../bitcoin'
import { zeroBytes } from '../ceremony/directauth'
import { fetchAddressUtxos } from '../esplora'
import { vaultArkServer } from './spend'
import { browserVaultLockManager, requireVaultLockManager, type VaultLockManager } from './lock'

export const VAULT_BOARD_V1 = 'vault-board-v1'
export const VAULT_BOARD_V1_EXIT_DELAY = 604672n
export const VAULT_BOARD_V1_EXIT_DELAY_UNIT = 'seconds' as const

const VAULT_SDK_STORAGE_PREFIX = 'arkade-vault-v2'

const BOARDING_LOCK_BRAND: unique symbol = Symbol('vault-boarding-lock')
const activeBoardingLocks = new WeakSet<object>()

export interface VaultBoardingLock {
  readonly [BOARDING_LOCK_BRAND]: true
}

export type VaultBoardingLockResult<T> = { held: false } | { held: true; value: T }

function requireActiveBoardingLock(lock: VaultBoardingLock) {
  if (!activeBoardingLocks.has(lock)) throw new Error('Active vault boarding lock required')
}

export async function withVaultBoardingLock<T>(
  vaultId: string,
  run: (lock: VaultBoardingLock) => Promise<T>,
  locks: VaultLockManager | null | undefined = browserVaultLockManager(),
): Promise<VaultBoardingLockResult<T>> {
  return requireVaultLockManager(locks).request(
    `arkade-vault-boarding:${vaultId}`,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) return { held: false }
      const guard = { [BOARDING_LOCK_BRAND]: true } as const
      activeBoardingLocks.add(guard)
      try {
        return { held: true, value: await run(guard) }
      } finally {
        activeBoardingLocks.delete(guard)
      }
    },
  ) as Promise<VaultBoardingLockResult<T>>
}

export function boardingAttemptKeyAfterLock(held: boolean, key: string): string {
  return held ? key : ''
}

export function isPasskeyCancellation(err: unknown): boolean {
  const raw = err instanceof Error ? err.message.toLowerCase() : String(err || '').toLowerCase()
  return raw.includes('the operation was aborted') || raw.includes('notallowederror')
}

/** Cancelled Face ID must not re-enter the settle effect until the next focus. */
export function boardingFailureHold(err: unknown, key: string): { attemptKey: string; retryDelayMs: number } {
  if (isPasskeyCancellation(err)) return { attemptKey: key, retryDelayMs: 0 }
  return { attemptKey: '', retryDelayMs: 5 * 60_000 }
}

export async function withVaultBoardingSecret<T>(secret: Uint8Array, run: (secret: Uint8Array) => Promise<T>) {
  try {
    return await run(secret)
  } finally {
    zeroBytes(secret)
  }
}

function xOnly(value: string | undefined, name: string): Uint8Array {
  const raw = String(value || '').toLowerCase()
  if (/^(02|03)[0-9a-f]{64}$/.test(raw)) return hex.decode(raw.slice(2))
  if (/^[0-9a-f]{64}$/.test(raw)) return hex.decode(raw)
  throw new Error(`${name} must be a secp256k1 public key`)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function requireBoardingStatus(status: VaultStatus) {
  if (!status.enrolled || status.network !== 'mutinynet') throw new Error('boarding is Mutinynet-only')
  if (!status.vtxoBoardingActive || status.vtxoBoardingProgram !== VAULT_BOARD_V1) {
    throw new Error('vault-board-v1 is not active on the vault service')
  }
  if (
    status.vtxoBoardingExitDelay !== Number(VAULT_BOARD_V1_EXIT_DELAY) ||
    status.vtxoBoardingExitDelayUnit !== VAULT_BOARD_V1_EXIT_DELAY_UNIT
  ) {
    throw new Error('vault-board-v1 exit delay does not match this release')
  }
  if (!status.vtxoBoardingAddress || !status.vtxoBoardingScript || !status.spendingArkAddress) {
    throw new Error('vault-board-v1 descriptor is incomplete')
  }
}

export function vaultBoardScriptFromStatus(status: VaultStatus, operatorPub: Uint8Array) {
  requireBoardingStatus(status)
  const script = new DefaultVtxo.Script({
    pubKey: xOnly(status.phoneBip340Pub, 'phone pubkey'),
    serverPubKey: operatorPub,
    csvTimelock: { type: VAULT_BOARD_V1_EXIT_DELAY_UNIT, value: VAULT_BOARD_V1_EXIT_DELAY },
  })
  const advertised = hex.decode(status.vtxoBoardingScript!)
  if (!sameBytes(script.pkScript, advertised)) throw new Error('vault-board-v1 script does not match the vault service')
  const address = script.onchainAddress(vaultAddressNetwork(status.network))
  if (address !== status.vtxoBoardingAddress) throw new Error('vault-board-v1 address does not match the vault service')
  return script
}

export interface VaultBoardingFunds {
  confirmed: number
  unconfirmed: number
  total: number
}

export type VaultBoardingAction = 'settle' | 'wait' | 'idle'

export function nextVaultBoardingAction(
  boarding: Pick<VaultBoardingFunds, 'confirmed' | 'total'>,
): VaultBoardingAction {
  if (boarding.confirmed > 0) return 'settle'
  if (boarding.total > 0) return 'wait'
  return 'idle'
}

export async function fetchVaultBoardingFunds(status: VaultStatus): Promise<VaultBoardingFunds> {
  requireBoardingStatus(status)
  const coins = await fetchAddressUtxos(status.vtxoBoardingAddress!)
  const confirmed = coins.filter((coin) => coin.status.confirmed).reduce((sum, coin) => sum + coin.value, 0)
  const unconfirmed = coins.filter((coin) => !coin.status.confirmed).reduce((sum, coin) => sum + coin.value, 0)
  return { confirmed, unconfirmed, total: confirmed + unconfirmed }
}

export function vaultBoardingStorageNames(vaultId: string): { wallet: string; intents: string } {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('vault id required for SDK storage')
  const scope = encodeURIComponent(id)
  return {
    wallet: `${VAULT_SDK_STORAGE_PREFIX}:${scope}:wallet`,
    intents: `${VAULT_SDK_STORAGE_PREFIX}:${scope}:intents`,
  }
}

type BoardingStorageFactories<W, C, I> = {
  walletRepository: (dbName: string) => W
  contractRepository: (dbName: string) => C
  intentRepository: (dbName: string) => I
}

export function createVaultBoardingStorage(vaultId: string): {
  walletRepository: IndexedDBWalletRepository
  contractRepository: IndexedDBContractRepository
  intentRepository: IndexedDBIntentRepository
}
export function createVaultBoardingStorage<W, C, I>(
  vaultId: string,
  factories: BoardingStorageFactories<W, C, I>,
): { walletRepository: W; contractRepository: C; intentRepository: I }
export function createVaultBoardingStorage<W, C, I>(
  vaultId: string,
  factories: BoardingStorageFactories<W, C, I> = {
    walletRepository: (dbName) => new IndexedDBWalletRepository(dbName) as W,
    contractRepository: (dbName) => new IndexedDBContractRepository(dbName) as C,
    intentRepository: (dbName) => new IndexedDBIntentRepository(dbName) as I,
  },
) {
  const names = vaultBoardingStorageNames(vaultId)
  return {
    walletRepository: factories.walletRepository(names.wallet),
    contractRepository: factories.contractRepository(names.wallet),
    intentRepository: factories.intentRepository(names.intents),
  }
}

async function liveBoardingOperator(status: VaultStatus) {
  requireBoardingStatus(status)
  const operator = new RestArkProvider(vaultArkServer())
  const info = await operator.getInfo()
  if (info.network !== 'mutinynet') throw new Error('Operator network is not Mutinynet')
  if (BigInt(info.boardingExitDelay) !== VAULT_BOARD_V1_EXIT_DELAY) {
    throw new Error('Operator boarding delay changed from the release pin')
  }
  const operatorPub = xOnly(info.signerPubkey, 'Operator signer pubkey')
  vaultBoardScriptFromStatus(status, operatorPub)
  return { operator, info }
}

export async function verifyVaultBoarding(status: VaultStatus): Promise<void> {
  await liveBoardingOperator(status)
}

async function createBoardingWallet(phoneSecret: Uint8Array, status: VaultStatus) {
  const identity = SingleKey.fromPrivateKey(phoneSecret)
  const storage = createVaultBoardingStorage(status.vaultId)
  let wallet: Wallet | undefined
  try {
    const { operator, info } = await liveBoardingOperator(status)
    wallet = await Wallet.create({
      identity,
      arkServerUrl: vaultArkServer(),
      arkProvider: operator,
      indexerProvider: new RestIndexerProvider(vaultArkServer()),
      esploraUrl: '/esplora',
      boardingTimelock: { type: VAULT_BOARD_V1_EXIT_DELAY_UNIT, value: VAULT_BOARD_V1_EXIT_DELAY },
      settlementConfig: false,
      storage,
    })
    if ((await wallet.getBoardingAddress()) !== status.vtxoBoardingAddress) {
      throw new Error('SDK derived a different vault-board-v1 address')
    }
    return { wallet, info, storage }
  } catch (error) {
    try {
      await disposeVaultBoardingResources(wallet, storage)
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Failed to create and dispose the boarding wallet')
    }
    throw error
  }
}

type BoardingStorageResources = {
  walletRepository: { [Symbol.asyncDispose](): Promise<void> }
  contractRepository: { [Symbol.asyncDispose](): Promise<void> }
  intentRepository: { [Symbol.asyncDispose](): Promise<void> }
}

export async function disposeVaultBoardingResources(
  wallet: Pick<Wallet, 'dispose'> | undefined,
  storage: BoardingStorageResources,
) {
  let failure: unknown
  try {
    await wallet?.dispose()
  } catch (error) {
    failure = error
  }
  const repositories = await Promise.allSettled([
    storage.walletRepository[Symbol.asyncDispose](),
    storage.contractRepository[Symbol.asyncDispose](),
    storage.intentRepository[Symbol.asyncDispose](),
  ])
  for (const result of repositories) {
    if (result.status === 'rejected' && failure === undefined) failure = result.reason
  }
  if (failure !== undefined) throw failure
}

function boardingOutputAmount(
  coins: ExtendedCoin[],
  status: VaultStatus,
  intentFee: ConstructorParameters<typeof Estimator>[0],
) {
  const estimator = new Estimator(intentFee)
  let amount = coins.reduce((sum, coin) => {
    const inputFee = estimator.evalOnchainInput({ amount: BigInt(coin.value) })
    return sum + coin.value - inputFee.satoshis
  }, 0)
  const outputFee = estimator.evalOffchainOutput({
    amount: BigInt(amount),
    script: String(status.spendingArkScript || ''),
  })
  amount -= outputFee.satoshis
  if (!Number.isSafeInteger(amount) || amount < 330)
    throw new Error('boarding output is below dust after Operator fees')
  return amount
}

async function findConfirmedBoardingCoins(wallet: Wallet, txid?: string): Promise<ExtendedCoin[]> {
  const coins = await wallet.getBoardingUtxos()
  return coins
    .filter((coin) => coin.status.confirmed && (!txid || coin.txid === txid))
    .sort((a, b) => b.value - a.value)
}

export async function settleVaultBoarding(
  lock: VaultBoardingLock,
  phoneSecret: Uint8Array,
  status: VaultStatus,
  txid?: string,
): Promise<{ txid: string; amountSats: number }> {
  requireActiveBoardingLock(lock)
  const { wallet, info, storage } = await createBoardingWallet(phoneSecret, status)
  try {
    const coins = await findConfirmedBoardingCoins(wallet, txid)
    if (coins.length === 0) throw new Error('No confirmed boarding transaction yet')
    const amountSats = boardingOutputAmount(coins, status, info.fees.intentFee)
    const commitmentTxid = await wallet.settle({
      inputs: coins,
      outputs: [{ address: status.spendingArkAddress!, amount: BigInt(amountSats) }],
    })
    return { txid: commitmentTxid, amountSats }
  } finally {
    await disposeVaultBoardingResources(wallet, storage)
  }
}

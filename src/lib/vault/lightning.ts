import {
  ArkAddress,
  IndexedDBContractRepository,
  IndexedDBWalletRepository,
  RestArkProvider,
  RestIndexerProvider,
  SingleKey,
  Wallet,
  type IWallet,
  type NetworkName,
} from '@arkade-os/sdk'
import {
  IndexedDbAssetSwapRepository,
  RfqSwapManager,
  newRfqId,
  requestLightningSend,
  type AssetSwapRepository,
  type RfqTransport,
  type SwapContractRegistry,
} from '@arkade-os/swap'
import { nostrRfqTransport } from '@arkade-os/swap/nostr'
import { hex } from '@scure/base'
import { vaultLightningSendEnabled, type VaultLightningSolverProfile } from './lightningConfig'
import { decodeVaultLightningInvoice } from './lightningInvoice'
import { registeredContractScript, validateVaultLightningRequestResult } from './lightningValidation'
import {
  discardUnexposedVaultLightningQuote,
  persistVaultLightningQuote,
  restoreMatchingVaultLightningQuote,
  restorePersistedVaultLightningQuote,
  refreshVaultLightningLifecycle,
  startVaultLightningLifecycle,
  vaultLightningSwapStorageName,
  type VaultLightningQuote,
  type VaultLightningSession,
} from './lightningLifecycle'
import type { VaultStatus } from './types'
import { disposeVaultBoardingResources } from './vtxo/board'

export {
  isVaultLightningInput,
  MUTINYNET_LIGHTNING_SOLVER,
  vaultLightningSendEnabled,
  vaultLightningSolverProfile,
  type VaultLightningSolverProfile,
} from './lightningConfig'
export { LightningInvoiceRejected, decodeVaultLightningInvoice, wholeSatsFromMillisats } from './lightningInvoice'
export {
  assertVaultLightningQuoteCurrent,
  beginVaultLightningFunding,
  cancelVaultLightningQuote,
  getVaultLightningStatus,
  listVaultLightningHistory,
  recordVaultLightningFundingTxid,
  refreshVaultLightningLifecycle,
  retireAbandonedVaultLightningQuotes,
  startVaultLightningLifecycle,
  vaultLightningSwapStorageName,
  type VaultLightningFundingTarget,
  type VaultLightningHistoryMetadata,
  type VaultLightningQuote,
  type VaultLightningSession,
} from './lightningLifecycle'

/**
 * Keep the SDK wallet intact and substitute only its receive address. The
 * stock wallet still owns the identity, descriptor checks, contract manager,
 * IndexedDB repositories and every other method used by @arkade-os/swap.
 */
export function withVaultRefundAddress(wallet: IWallet, refundAddress: string): IWallet {
  ArkAddress.decode(refundAddress)
  const getAddress = async () => refundAddress
  return new Proxy(wallet, {
    get(target, property) {
      if (property === 'getAddress') return getAddress
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function validateVaultLightningRefund(
  status: VaultStatus,
  operatorNetwork: NetworkName,
  operatorSignerPubkey: string,
): ArkAddress {
  if (!status.enrolled || !status.vaultId) throw new Error('Enrolled vault required for Lightning.')
  if (status.network !== operatorNetwork) throw new Error('Vault and Arkade Operator networks do not match.')
  const refund = ArkAddress.decode(String(status.spendingArkAddress || ''))
  const expectedHrp = status.network === 'bitcoin' ? 'ark' : 'tark'
  if (refund.hrp !== expectedHrp) throw new Error('Spending refund address is encoded for another network.')
  const advertisedScript = String(status.spendingArkScript || '').toLowerCase()
  if (!/^[0-9a-f]{68}$/.test(advertisedScript) || hex.encode(refund.pkScript) !== advertisedScript) {
    throw new Error('Spending refund address does not match its pinned script.')
  }
  const signer = hex.decode(operatorSignerPubkey)
  const xOnlySigner = signer.length === 33 ? signer.slice(1) : signer
  if (xOnlySigner.length !== 32 || !sameBytes(refund.serverPubKey, xOnlySigner)) {
    throw new Error('Spending refund address belongs to another Arkade Operator.')
  }
  return refund
}

type VaultSdkWalletResources = {
  walletRepository: IndexedDBWalletRepository
  contractRepository: IndexedDBContractRepository
}

function createVaultLightningSdkStorage(vaultId: string): VaultSdkWalletResources {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('Vault ID is required for Lightning storage.')
  const database = vaultLightningWalletStorageName(id)
  return {
    walletRepository: new IndexedDBWalletRepository(database),
    contractRepository: new IndexedDBContractRepository(database),
  }
}

function vaultLightningWalletStorageName(vaultId: string): string {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('Vault ID is required for Lightning storage.')
  return `arkade-vault-v2:${encodeURIComponent(id)}:wallet`
}

export async function withVaultLightningSdkWallet<T>(
  phoneSecret: Uint8Array,
  status: VaultStatus,
  arkServerUrl: string,
  run: (session: VaultLightningSession) => Promise<T>,
): Promise<T> {
  if (!status.spendingArkAddress) throw new Error('Vault has no Spending address.')
  const identity = SingleKey.fromPrivateKey(phoneSecret)
  if (hex.encode(await identity.compressedPublicKey()) !== String(status.phoneBip340Pub || '')) {
    throw new Error('Phone key does not match this vault.')
  }
  const storage = createVaultLightningSdkStorage(status.vaultId)
  const repository = new IndexedDbAssetSwapRepository(vaultLightningSwapStorageName(status.vaultId))
  const operator = new RestArkProvider(arkServerUrl)
  const indexer = new RestIndexerProvider(arkServerUrl)
  let wallet: Wallet | undefined
  let lifecycle: Omit<VaultLightningSession, 'wallet' | 'repository'> | undefined
  let primaryError: unknown
  try {
    const info = await operator.getInfo()
    if (info.network !== status.network) throw new Error('Vault and Arkade Operator networks do not match.')
    validateVaultLightningRefund(status, info.network as NetworkName, info.signerPubkey)
    wallet = await Wallet.create({
      identity,
      arkServerUrl,
      arkProvider: operator,
      indexerProvider: indexer,
      settlementConfig: false,
      storage,
    })
    const adaptedWallet = withVaultRefundAddress(wallet, status.spendingArkAddress)
    lifecycle = await startVaultLightningLifecycle({
      wallet: adaptedWallet,
      ark: operator,
      indexer,
      repository,
    })
    const lifecycleErrors = [
      ...lifecycle.restoreFailures.map(({ error }) => error),
      ...lifecycle.retirementFailures.map(({ error }) => error),
    ]
    if (lifecycleErrors.length > 0) {
      throw new AggregateError(lifecycleErrors, 'Lightning recovery state could not be restored safely')
    }
    return await run({ wallet: adaptedWallet, repository, ...lifecycle })
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    const cleanupErrors: unknown[] = []
    if (lifecycle) {
      try {
        await lifecycle.manager.stop()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    try {
      await repository[Symbol.asyncDispose]()
    } catch (error) {
      cleanupErrors.push(error)
    }
    try {
      await disposeVaultBoardingResources(wallet, storage)
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (cleanupErrors.length > 0) {
      if (primaryError !== undefined) {
        throw new AggregateError([primaryError, ...cleanupErrors], 'Lightning request and SDK cleanup failed')
      }
      if (cleanupErrors.length === 1) throw cleanupErrors[0]
      throw new AggregateError(cleanupErrors, 'Lightning SDK cleanup failed')
    }
  }
}

type LightningRequester = typeof requestLightningSend

export async function withVaultLightningRepository<T>(
  vaultId: string,
  run: (repository: IndexedDbAssetSwapRepository) => Promise<T>,
): Promise<T> {
  const repository = new IndexedDbAssetSwapRepository(vaultLightningSwapStorageName(vaultId))
  try {
    return await run(repository)
  } finally {
    await repository[Symbol.asyncDispose]()
  }
}

export async function refreshVaultLightningHistory(
  vaultId: string,
  arkServerUrl: string,
): Promise<import('./lightningLifecycle').VaultLightningHistoryMetadata[]> {
  const repository = new IndexedDbAssetSwapRepository(vaultLightningSwapStorageName(vaultId))
  const contracts = new IndexedDBContractRepository(vaultLightningWalletStorageName(vaultId))
  let primaryError: unknown
  try {
    const refreshed = await refreshVaultLightningLifecycle({
      repository,
      contracts,
      indexer: new RestIndexerProvider(arkServerUrl),
    })
    if (refreshed.restoreFailures.length > 0) {
      throw new AggregateError(
        refreshed.restoreFailures.map(({ error }) => error),
        'Lightning recovery state could not be restored safely',
      )
    }
    return refreshed.history
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    const cleanup = await Promise.allSettled([repository[Symbol.asyncDispose](), contracts[Symbol.asyncDispose]()])
    const cleanupErrors = cleanup
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (cleanupErrors.length > 0) {
      if (primaryError !== undefined) {
        throw new AggregateError([primaryError, ...cleanupErrors], 'Lightning refresh and cleanup failed')
      }
      if (cleanupErrors.length === 1) throw cleanupErrors[0]
      throw new AggregateError(cleanupErrors, 'Lightning refresh cleanup failed')
    }
  }
}

export async function requestVaultLightningQuote({
  wallet,
  arkServerUrl,
  invoice,
  network,
  transport,
  repository,
  contracts,
  manager,
  profile,
  rfqId,
  requester = requestLightningSend,
  nowSeconds = Math.floor(Date.now() / 1000),
  enabled = vaultLightningSendEnabled(),
}: {
  wallet: IWallet
  arkServerUrl: string
  invoice: string
  network: NetworkName
  transport: RfqTransport
  repository: AssetSwapRepository
  contracts: SwapContractRegistry
  manager: RfqSwapManager
  profile: VaultLightningSolverProfile
  rfqId?: string
  requester?: LightningRequester
  nowSeconds?: number
  enabled?: boolean
}): Promise<VaultLightningQuote> {
  if (!enabled) throw new Error('Lightning send is not enabled in this release.')
  if (profile.network !== network) throw new Error('Lightning solver profile is for another network.')
  if (!/^[0-9a-f]{64}$/.test(profile.pubkey)) throw new Error('Lightning solver pubkey is invalid.')
  if (
    profile.relays.length === 0 ||
    profile.relays.some((relay) => {
      try {
        return new URL(relay).protocol !== 'wss:'
      } catch {
        return true
      }
    })
  ) {
    throw new Error('Lightning solver relay configuration is invalid.')
  }
  if (
    !Number.isSafeInteger(profile.minSats) ||
    !Number.isSafeInteger(profile.maxSats) ||
    profile.minSats < 1 ||
    profile.maxSats < profile.minSats
  ) {
    throw new Error('Lightning solver amount limits are invalid.')
  }
  const facts = decodeVaultLightningInvoice(invoice, network, nowSeconds)
  if (facts.amountSats < profile.minSats || facts.amountSats > profile.maxSats) {
    throw new Error(
      `Lightning amount must be ${profile.minSats.toLocaleString()}–${profile.maxSats.toLocaleString()} sats.`,
    )
  }
  if (rfqId !== undefined && !/^[0-9a-f]{64}$/.test(rfqId)) {
    throw new Error('Lightning RFQ id must be 32 bytes of lowercase hex.')
  }
  const existing = rfqId
    ? await restorePersistedVaultLightningQuote(repository, contracts, manager, rfqId, facts.raw, network)
    : await restoreMatchingVaultLightningQuote(repository, contracts, manager, facts.raw, network)
  if (existing) return existing

  const requestId = rfqId ?? newRfqId()

  const result = await requester(wallet, arkServerUrl, transport, { invoice: facts, rfqId: requestId })
  const contractScript = registeredContractScript(result)
  try {
    const { contractParams, refundLocktime } = await validateVaultLightningRequestResult({
      result,
      rfqId: requestId,
      facts,
      wallet,
      contracts,
      nowSeconds,
    })

    return await persistVaultLightningQuote({
      result,
      facts,
      refundLocktime,
      contractParams,
      repository,
      manager,
      network,
      nowSeconds,
    })
  } catch (error) {
    return discardUnexposedVaultLightningQuote(repository, contracts, manager, requestId, contractScript, error)
  }
}

export function vaultLightningTransport(profile: VaultLightningSolverProfile): RfqTransport {
  return nostrRfqTransport({
    relays: [...profile.relays],
    solverPubkey: profile.pubkey,
    timeoutMs: 30_000,
  })
}

export async function withVaultLightningTransport<T>(
  profile: VaultLightningSolverProfile,
  run: (transport: RfqTransport) => Promise<T>,
  createTransport: (profile: VaultLightningSolverProfile) => RfqTransport = vaultLightningTransport,
): Promise<T> {
  const transport = createTransport(profile)
  try {
    return await run(transport)
  } finally {
    await transport.close()
  }
}

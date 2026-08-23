import {
  ArkAddress,
  RestArkProvider,
  RestIndexerProvider,
  SingleKey,
  Wallet,
  type IWallet,
  type IndexedDBContractRepository,
  type IndexedDBIntentRepository,
  type IndexedDBWalletRepository,
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
import {
  decodeVaultLightningInvoice,
  registeredContractScript,
  validateVaultLightningRequestResult,
} from './lightningValidation'
import {
  discardUnexposedVaultLightningQuote,
  persistVaultLightningQuote,
  restorePersistedVaultLightningQuote,
  startVaultLightningLifecycle,
  vaultLightningSwapStorageName,
  type VaultLightningQuote,
  type VaultLightningSession,
} from './lightningLifecycle'
import type { VaultStatus } from './types'
import { createVaultBoardingStorage, disposeVaultBoardingResources } from './vtxo/board'

export { LightningInvoiceRejected, decodeVaultLightningInvoice, wholeSatsFromMillisats } from './lightningValidation'
export {
  assertVaultLightningQuoteCurrent,
  beginVaultLightningFunding,
  cancelVaultLightningQuote,
  getVaultLightningStatus,
  recordVaultLightningFundingTxid,
  retireAbandonedVaultLightningQuotes,
  startVaultLightningLifecycle,
  vaultLightningSwapStorageName,
  type VaultLightningFundingTarget,
  type VaultLightningQuote,
  type VaultLightningSession,
} from './lightningLifecycle'

const LIGHTNING_SEND_RELEASE_FLAG = 'true'

/**
 * Candidate fields copied from the production card bundled by the official
 * Arkade Wallet at arkade-os/wallet@60cc144. The public registry currently
 * advertises no mainnet Lightning market. These fields remain disabled until
 * the card and its rotation procedure are approved as release pins.
 */
export const MAINNET_LIGHTNING_SOLVER_CANDIDATE = {
  pubkey: '66422c952f8dcb96e4d0c3f049cd1e265b8461b916d9913c65c2494b64b4e3ce',
  relays: ['wss://nostr.arkade.sh'],
  minSats: 500,
  maxSats: 50_000,
} as const

export function vaultLightningSendEnabled(value = import.meta.env.VITE_VAULT_LIGHTNING_SEND): boolean {
  return value === LIGHTNING_SEND_RELEASE_FLAG
}

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
  if (status.network !== 'bitcoin' || operatorNetwork !== 'bitcoin') {
    throw new Error('Lightning send is enabled for mainnet only.')
  }
  const refund = ArkAddress.decode(String(status.spendingArkAddress || ''))
  if (refund.hrp !== 'ark') throw new Error('Spending refund address is encoded for another network.')
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
  intentRepository: IndexedDBIntentRepository
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
  const storage: VaultSdkWalletResources = createVaultBoardingStorage(status.vaultId)
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

export async function requestVaultLightningQuote({
  wallet,
  arkServerUrl,
  invoice,
  network,
  transport,
  repository,
  contracts,
  manager,
  rfqId = newRfqId(),
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
  rfqId?: string
  requester?: LightningRequester
  nowSeconds?: number
  enabled?: boolean
}): Promise<VaultLightningQuote> {
  if (!enabled) throw new Error('Lightning send is not enabled in this release.')
  if (network !== 'bitcoin') throw new Error('Lightning send is enabled for mainnet only.')
  const facts = decodeVaultLightningInvoice(invoice, network, nowSeconds)
  if (
    facts.amountSats < MAINNET_LIGHTNING_SOLVER_CANDIDATE.minSats ||
    facts.amountSats > MAINNET_LIGHTNING_SOLVER_CANDIDATE.maxSats
  ) {
    throw new Error(
      `Lightning amount must be ${MAINNET_LIGHTNING_SOLVER_CANDIDATE.minSats.toLocaleString()}–${MAINNET_LIGHTNING_SOLVER_CANDIDATE.maxSats.toLocaleString()} sats.`,
    )
  }
  if (!/^[0-9a-f]{64}$/.test(rfqId)) throw new Error('Lightning RFQ id must be 32 bytes of lowercase hex.')
  const existing = await restorePersistedVaultLightningQuote(repository, contracts, manager, rfqId, facts.raw)
  if (existing) return existing

  const result = await requester(wallet, arkServerUrl, transport, { invoice: facts, rfqId })
  const contractScript = registeredContractScript(result)
  try {
    const { contractParams, refundLocktime } = await validateVaultLightningRequestResult({
      result,
      rfqId,
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
      nowSeconds,
    })
  } catch (error) {
    return discardUnexposedVaultLightningQuote(repository, contracts, manager, rfqId, contractScript, error)
  }
}

export function mainnetLightningTransport(): RfqTransport {
  return nostrRfqTransport({
    relays: [...MAINNET_LIGHTNING_SOLVER_CANDIDATE.relays],
    solverPubkey: MAINNET_LIGHTNING_SOLVER_CANDIDATE.pubkey,
    timeoutMs: 30_000,
  })
}

export async function withMainnetLightningTransport<T>(
  run: (transport: RfqTransport) => Promise<T>,
  createTransport: () => RfqTransport = mainnetLightningTransport,
): Promise<T> {
  const transport = createTransport()
  try {
    return await run(transport)
  } finally {
    await transport.close()
  }
}

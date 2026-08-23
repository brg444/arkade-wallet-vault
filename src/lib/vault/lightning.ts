import {
  ArkAddress,
  RestArkProvider,
  RestIndexerProvider,
  SingleKey,
  VHTLCV2ContractHandler,
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
  arkadeRefunder,
  createRfqSwapRecord,
  isRfqSwapTerminal,
  lockupContractParams,
  newRfqId,
  rebuildRfqSwap,
  requestLightningSend,
  rfqSecretsProfile,
  type AssetSwapRepository,
  type InvoiceFacts,
  type LightningSendSwap,
  type RfqQuote,
  type RfqRestoreFailure,
  type RfqSwapManagerConfig,
  type RfqSwapRecord,
  type RfqTransport,
  type SwapContractRegistry,
} from '@arkade-os/swap'
import { nostrRfqTransport } from '@arkade-os/swap/nostr'
import { hex } from '@scure/base'
import bolt11 from 'light-bolt11-decoder'
import type { VaultStatus } from './types'
import { createVaultBoardingStorage, disposeVaultBoardingResources } from './vtxo/board'

const LIGHTNING_SEND_RELEASE_FLAG = 'true'
const VAULT_LIGHTNING_PROFILE = 'vaultLightning'
const VAULT_LIGHTNING_PROFILE_VERSION = 1
const VAULT_LIGHTNING_STORAGE_PREFIX = 'arkade-vault-v2'

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

const NETWORK_PREFIX: Record<NetworkName, string> = {
  bitcoin: 'bc',
  testnet: 'tb',
  signet: 'tbs',
  mutinynet: 'tbs',
  regtest: 'bcrt',
}

export interface VaultLightningQuote {
  kind: 'lightning'
  invoice: string
  invoiceAmountSats: number
  invoiceExpiresAt: number
  rfqId: string
  fundAmountSats: number
  corridorFeeSats: number
  validUntil: number
  refundLocktime: number
}

export interface VaultLightningFundingTarget {
  rfqId: string
  address: string
  amountSats: number
}

type VaultLightningFundingState = 'quoted' | 'funding' | 'cancel_requested'

interface StoredVaultLightningProfile {
  version: 1
  invoice: string
  invoiceAmountSats: number
  invoiceExpiresAt: number
  fundAmountSats: number
  corridorFeeSats: number
  validUntil: number
  refundLocktime: number
  refundAddress: string
  swapPkScript: string
  senderPubkey: string
  quote: RfqQuote
  fundingState: VaultLightningFundingState
}

export interface VaultLightningSession {
  wallet: IWallet
  repository: AssetSwapRepository
  contracts: SwapContractRegistry
  manager: RfqSwapManager
  restoreFailures: RfqRestoreFailure[]
  retiredQuoteIds: string[]
  retirementFailures: { rfqId: string; error: Error }[]
}

export class LightningInvoiceRejected extends Error {
  constructor(
    readonly reason:
      | 'unparseable'
      | 'wrong_network'
      | 'expired'
      | 'zero_amount'
      | 'fractional_amount'
      | 'no_payment_hash',
    message: string,
  ) {
    super(message)
    this.name = 'LightningInvoiceRejected'
  }
}

export function vaultLightningSendEnabled(value = import.meta.env.VITE_VAULT_LIGHTNING_SEND): boolean {
  return value === LIGHTNING_SEND_RELEASE_FLAG
}

export function wholeSatsFromMillisats(amountMillisats: number): number {
  if (!Number.isSafeInteger(amountMillisats) || amountMillisats <= 0) {
    throw new LightningInvoiceRejected('zero_amount', 'Enter a Lightning invoice with an amount.')
  }
  if (amountMillisats % 1000 !== 0) {
    throw new LightningInvoiceRejected('fractional_amount', 'This invoice amount is smaller than one whole satoshi.')
  }
  const amountSats = amountMillisats / 1000
  if (!Number.isSafeInteger(amountSats)) {
    throw new LightningInvoiceRejected('unparseable', 'This Lightning invoice amount is too large.')
  }
  return amountSats
}

export function decodeVaultLightningInvoice(
  rawInvoice: string,
  network: NetworkName,
  nowSeconds = Math.floor(Date.now() / 1000),
): InvoiceFacts {
  const invoice = rawInvoice.trim().replace(/^lightning:/i, '')
  let decoded: ReturnType<typeof bolt11.decode>
  try {
    decoded = bolt11.decode(invoice)
  } catch {
    throw new LightningInvoiceRejected('unparseable', 'Enter a valid Lightning invoice.')
  }
  const amountMillisats = Number(decoded.sections.find((section) => section.name === 'amount')?.value ?? '0')
  const timestamp = Number(decoded.sections.find((section) => section.name === 'timestamp')?.value ?? 0)
  const paymentHash = String(decoded.sections.find((section) => section.name === 'payment_hash')?.value ?? '')
  const coinNetwork = decoded.sections.find((section) => section.name === 'coin_network')
  const prefix = coinNetwork && 'value' in coinNetwork ? String(coinNetwork.value?.bech32 ?? '') : ''
  const expiresAt = timestamp + (decoded.expiry ?? 3600)
  if (prefix !== NETWORK_PREFIX[network]) {
    throw new LightningInvoiceRejected('wrong_network', `This invoice is not for ${network}.`)
  }
  if (!timestamp || nowSeconds >= expiresAt) {
    throw new LightningInvoiceRejected('expired', 'This Lightning invoice has expired.')
  }
  const amountSats = wholeSatsFromMillisats(amountMillisats)
  if (!/^[0-9a-f]{64}$/.test(paymentHash)) {
    throw new LightningInvoiceRejected('no_payment_hash', 'This Lightning invoice has no payment hash.')
  }
  return { raw: invoice, paymentHash, amountSats, expiresAt }
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

export function vaultLightningSwapStorageName(vaultId: string): string {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('vault id required for Lightning storage')
  return `${VAULT_LIGHTNING_STORAGE_PREFIX}:${encodeURIComponent(id)}:rfq-swaps`
}

function storedLightningProfile(record: RfqSwapRecord): StoredVaultLightningProfile {
  const value = record.profile[VAULT_LIGHTNING_PROFILE] as Partial<StoredVaultLightningProfile> | undefined
  if (
    record.kind !== 'lightning_send' ||
    !value ||
    value.version !== VAULT_LIGHTNING_PROFILE_VERSION ||
    typeof value.invoice !== 'string' ||
    !Number.isSafeInteger(value.invoiceAmountSats) ||
    !Number.isSafeInteger(value.invoiceExpiresAt) ||
    !Number.isSafeInteger(value.fundAmountSats) ||
    !Number.isSafeInteger(value.corridorFeeSats) ||
    !Number.isSafeInteger(value.validUntil) ||
    !Number.isSafeInteger(value.refundLocktime) ||
    typeof value.refundAddress !== 'string' ||
    !/^[0-9a-f]+$/.test(String(value.swapPkScript || '')) ||
    !/^[0-9a-f]{64}$/.test(String(value.senderPubkey || '')) ||
    !value.quote ||
    value.quote.rfq_id !== record.rfqId ||
    value.quote.valid_until !== value.validUntil ||
    value.quote.refund_locktime !== value.refundLocktime ||
    !['quoted', 'funding', 'cancel_requested'].includes(String(value.fundingState))
  ) {
    throw new Error(`Stored Lightning quote ${record.rfqId} is incomplete`)
  }
  return value as StoredVaultLightningProfile
}

function quoteFromRecord(record: RfqSwapRecord): VaultLightningQuote {
  const stored = storedLightningProfile(record)
  return {
    kind: 'lightning',
    invoice: stored.invoice,
    invoiceAmountSats: stored.invoiceAmountSats,
    invoiceExpiresAt: stored.invoiceExpiresAt,
    rfqId: record.rfqId,
    fundAmountSats: stored.fundAmountSats,
    corridorFeeSats: stored.corridorFeeSats,
    validUntil: stored.validUntil,
    refundLocktime: stored.refundLocktime,
  }
}

async function retireStoredLightningQuote(
  repository: Pick<AssetSwapRepository, 'removeRfqSwap'>,
  contracts: Pick<SwapContractRegistry, 'setContractWatchState'>,
  record: RfqSwapRecord,
): Promise<void> {
  const stored = storedLightningProfile(record)
  await contracts.setContractWatchState(stored.swapPkScript, 'retained')
  await repository.removeRfqSwap(record.rfqId)
}

export async function retireAbandonedVaultLightningQuotes(
  repository: Pick<AssetSwapRepository, 'getAllRfqSwaps' | 'removeRfqSwap'>,
  contracts: Pick<SwapContractRegistry, 'setContractWatchState'>,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ retired: string[]; failed: { rfqId: string; error: Error }[] }> {
  const retired: string[] = []
  const failed: { rfqId: string; error: Error }[] = []
  for (const record of await repository.getAllRfqSwaps()) {
    let stored: StoredVaultLightningProfile
    try {
      stored = storedLightningProfile(record)
    } catch {
      continue
    }
    if (
      stored.fundingState !== 'cancel_requested' &&
      !(stored.fundingState === 'quoted' && nowSeconds >= stored.validUntil)
    ) {
      continue
    }
    try {
      await retireStoredLightningQuote(repository, contracts, record)
      retired.push(record.rfqId)
    } catch (error) {
      failed.push({ rfqId: record.rfqId, error: error instanceof Error ? error : new Error(String(error)) })
    }
  }
  return { retired, failed }
}

export async function startVaultLightningLifecycle({
  wallet,
  ark,
  indexer,
  repository,
  managerConfig,
  refundArkade,
}: {
  wallet: IWallet
  ark: RestArkProvider
  indexer: RestIndexerProvider
  repository: AssetSwapRepository
  managerConfig?: RfqSwapManagerConfig
  refundArkade?: Parameters<RfqSwapManager['setCallbacks']>[0]['refundArkade']
}): Promise<Omit<VaultLightningSession, 'wallet' | 'repository'>> {
  const contracts = await wallet.getContractManager()
  const retired = await retireAbandonedVaultLightningQuotes(repository, contracts, managerConfig?.now?.())
  const manager = new RfqSwapManager({ indexer, repository, contracts }, managerConfig)
  manager.setCallbacks({
    refundArkade: refundArkade ?? arkadeRefunder({ ark, indexer, wallet, repository }),
  })
  const restored = await manager.restoreFromRepository()
  await manager.start()
  return {
    contracts,
    manager,
    restoreFailures: restored.failed,
    retiredQuoteIds: retired.retired,
    retirementFailures: retired.failed,
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameContractParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
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

async function cleanupUnexposedLightningQuote(
  repository: Pick<AssetSwapRepository, 'removeRfqSwap'>,
  contracts: Pick<SwapContractRegistry, 'setContractWatchState'>,
  manager: RfqSwapManager,
  rfqId: string,
  swapPkScript: string,
  primaryError: unknown,
): Promise<never> {
  const cleanup = await Promise.allSettled([
    manager.removeSwap(rfqId),
    contracts.setContractWatchState(swapPkScript, 'retained'),
    repository.removeRfqSwap(rfqId),
  ])
  const cleanupErrors = cleanup
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
  if (cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'Lightning quote persistence and cleanup failed')
  }
  throw primaryError
}

async function restorePersistedLightningQuote(
  repository: Pick<AssetSwapRepository, 'getRfqSwap'>,
  contracts: SwapContractRegistry,
  manager: RfqSwapManager,
  rfqId: string,
  invoice: string,
): Promise<VaultLightningQuote | undefined> {
  const record = await repository.getRfqSwap(rfqId)
  if (!record) return undefined
  const stored = storedLightningProfile(record)
  if (stored.invoice !== invoice) throw new Error(`Lightning request ${rfqId} belongs to another invoice.`)
  if (stored.fundingState === 'cancel_requested') throw new Error('This Lightning quote was cancelled.')
  if (isRfqSwapTerminal(record.state)) throw new Error('This Lightning payment is already resolved.')
  const params = await lockupContractParams(contracts, record.lockupAddress)
  const swap = rebuildRfqSwap(record, params)
  if (!(await manager.hasSwap(rfqId))) await manager.addSwap(swap)
  return quoteFromRecord(record)
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
  const existing = await restorePersistedLightningQuote(repository, contracts, manager, rfqId, facts.raw)
  if (existing) return existing

  const result = await requester(wallet, arkServerUrl, transport, { invoice: facts, rfqId })
  const swapPkScript = hex.encode(result.swapPkScript)
  try {
    if (result.rfqId !== rfqId || result.quote.rfq_id !== rfqId) {
      throw new Error('Lightning solver changed the RFQ id.')
    }
    if (!Number.isSafeInteger(result.fundAmount) || result.fundAmount < facts.amountSats) {
      throw new Error('Lightning solver returned an invalid funding amount.')
    }
    if (!Number.isSafeInteger(result.quote.valid_until) || result.quote.valid_until <= nowSeconds) {
      throw new Error('Lightning quote expired before Review.')
    }
    const refundLocktime = Number(result.quote.refund_locktime)
    if (!Number.isSafeInteger(refundLocktime)) {
      throw new Error('Lightning quote has no refund time.')
    }
    const refundAddress = await wallet.getAddress()
    if (result.refundAddress !== refundAddress) throw new Error('Lightning quote changed the Vault refund address.')
    const senderPubkey = hex.encode(result.senderPubkey)
    if (
      senderPubkey !== hex.encode(result.treeParams.senderPubkey) ||
      senderPubkey !== hex.encode(result.secrets.pubkey)
    ) {
      throw new Error('Lightning refund signer changed during quote construction.')
    }
    if (!sameBytes(result.swapPkScript, result.script.pkScript)) {
      throw new Error('Lightning lockup script changed during quote construction.')
    }

    const persistedContractParams = await lockupContractParams(contracts, result.address)
    const expectedContractParams = VHTLCV2ContractHandler.serializeParams(result.script.options)
    if (!sameContractParams(persistedContractParams, expectedContractParams)) {
      throw new Error('Persisted Lightning contract does not contain the quoted recovery tree.')
    }

    const stored: StoredVaultLightningProfile = {
      version: VAULT_LIGHTNING_PROFILE_VERSION,
      invoice: facts.raw,
      invoiceAmountSats: facts.amountSats,
      invoiceExpiresAt: facts.expiresAt,
      fundAmountSats: result.fundAmount,
      corridorFeeSats: result.fundAmount - facts.amountSats,
      validUntil: result.quote.valid_until,
      refundLocktime,
      refundAddress,
      swapPkScript,
      senderPubkey,
      quote: result.quote,
      fundingState: 'quoted',
    }
    const swap: LightningSendSwap = {
      kind: 'lightning_send',
      rfqId,
      state: 'pending',
      lockupPkScript: result.swapPkScript,
      lockup: { script: result.script, address: result.address },
      paymentHash: facts.paymentHash,
      refundLocktime,
      createdAt: nowSeconds,
      updatedAt: nowSeconds,
    }
    const origin = {
      kind: 'lightning_send' as const,
      lockupAddress: result.address,
      amount: result.fundAmount,
      profile: {
        ...rfqSecretsProfile(result.secrets, facts.paymentHash),
        [VAULT_LIGHTNING_PROFILE]: stored,
      },
    }
    await repository.saveRfqSwap(createRfqSwapRecord(origin, swap))

    const persisted = await repository.getRfqSwap(rfqId)
    if (!persisted) throw new Error('Lightning recovery record was not durably stored.')
    const rebuilt = rebuildRfqSwap(persisted, persistedContractParams)
    await manager.addSwap(rebuilt)
    return quoteFromRecord(persisted)
  } catch (error) {
    return cleanupUnexposedLightningQuote(repository, contracts, manager, rfqId, swapPkScript, error)
  }
}

export async function beginVaultLightningFunding(
  repository: Pick<AssetSwapRepository, 'getRfqSwap' | 'saveRfqSwap'>,
  rfqId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VaultLightningFundingTarget> {
  const record = await repository.getRfqSwap(rfqId)
  if (!record) throw new Error('Lightning recovery record is missing. Do not fund this quote.')
  if (isRfqSwapTerminal(record.state)) throw new Error('This Lightning payment is already resolved.')
  const stored = storedLightningProfile(record)
  if (stored.fundingState === 'cancel_requested') throw new Error('This Lightning quote was cancelled.')
  const quote = quoteFromRecord(record)
  assertVaultLightningQuoteCurrent(quote, nowSeconds)
  if (stored.fundingState === 'quoted') {
    const updated: RfqSwapRecord = {
      ...record,
      profile: {
        ...record.profile,
        [VAULT_LIGHTNING_PROFILE]: { ...stored, fundingState: 'funding' },
      },
    }
    await repository.saveRfqSwap(updated)
    const persisted = await repository.getRfqSwap(rfqId)
    if (!persisted || storedLightningProfile(persisted).fundingState !== 'funding') {
      throw new Error('Lightning funding permission was not durably stored. Do not fund this quote.')
    }
  }
  return { rfqId, address: record.lockupAddress, amountSats: stored.fundAmountSats }
}

export async function recordVaultLightningFundingTxid(
  repository: Pick<AssetSwapRepository, 'getRfqSwap' | 'saveRfqSwap'>,
  rfqId: string,
  fundingArkTxid: string,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(fundingArkTxid)) throw new Error('Lightning funding transaction id is invalid.')
  const record = await repository.getRfqSwap(rfqId)
  if (!record) throw new Error('Lightning recovery record is missing.')
  const stored = storedLightningProfile(record)
  if (stored.fundingState !== 'funding') throw new Error('Lightning funding was not prepared.')
  if (record.fundingArkTxid && record.fundingArkTxid !== fundingArkTxid) {
    throw new Error('Lightning quote is already bound to another funding transaction.')
  }
  await repository.saveRfqSwap({ ...record, fundingArkTxid })
}

export async function cancelVaultLightningQuote(
  session: Pick<VaultLightningSession, 'repository' | 'contracts' | 'manager'>,
  rfqId: string,
): Promise<boolean> {
  const record = await session.repository.getRfqSwap(rfqId)
  if (!record) return false
  const stored = storedLightningProfile(record)
  if (stored.fundingState === 'funding' || record.fundingArkTxid) {
    throw new Error('Lightning funding has started. This payment must resolve or refund.')
  }
  if (isRfqSwapTerminal(record.state)) throw new Error('This Lightning payment is already resolved.')
  if (stored.fundingState !== 'cancel_requested') {
    await session.repository.saveRfqSwap({
      ...record,
      profile: {
        ...record.profile,
        [VAULT_LIGHTNING_PROFILE]: { ...stored, fundingState: 'cancel_requested' },
      },
    })
  }
  await session.manager.removeSwap(rfqId)
  const current = await session.repository.getRfqSwap(rfqId)
  if (!current) return true
  await retireStoredLightningQuote(session.repository, session.contracts, current)
  return true
}

export async function getVaultLightningStatus(
  repository: Pick<AssetSwapRepository, 'getRfqSwap'>,
  rfqId: string,
): Promise<RfqSwapRecord | undefined> {
  return repository.getRfqSwap(rfqId)
}

export function assertVaultLightningQuoteCurrent(
  quote: VaultLightningQuote,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (nowSeconds >= quote.invoiceExpiresAt) throw new Error('This Lightning invoice has expired.')
  if (nowSeconds >= quote.validUntil) throw new Error('This Lightning quote has expired. Return to Send and try again.')
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

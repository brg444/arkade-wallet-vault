import {
  ArkAddress,
  type IWallet,
  type NetworkName,
  type RestArkProvider,
  type RestIndexerProvider,
} from '@arkade-os/sdk'
import {
  RfqSwapManager,
  arkadeRefunder,
  createRfqSwapRecord,
  isRfqSwapTerminal,
  lockupContractParams,
  rebuildRfqSwap,
  rfqSecretsProfile,
  type AssetSwapRepository,
  type InvoiceFacts,
  type LightningSendSwap,
  type RfqQuote,
  type RfqRestoreFailure,
  type RfqSwapManagerConfig,
  type RfqSwapRecord,
  type SwapContractRegistry,
} from '@arkade-os/swap'
import { hex } from '@scure/base'
import { decodeVaultLightningInvoice } from './lightningInvoice'
import type { LightningRequestResult } from './lightningValidation'

const VAULT_LIGHTNING_PROFILE = 'vaultLightning'
const VAULT_LIGHTNING_PROFILE_VERSION = 2
const VAULT_LIGHTNING_STORAGE_PREFIX = 'arkade-vault-v2'

export interface VaultLightningQuote {
  kind: 'lightning'
  invoice: string
  invoiceAmountSats: number
  invoiceExpiresAt: number
  rfqId: string
  fundAddress: string
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

export interface VaultLightningHistoryMetadata {
  txid: string
  invoiceAmountSats: number
  state: string
}

type VaultLightningFundingState = 'quoted' | 'funding' | 'cancel_requested'

interface StoredVaultLightningProfile {
  version: 2
  network: NetworkName
  invoice: string
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

export function vaultLightningSwapStorageName(vaultId: string): string {
  const id = String(vaultId || '').trim()
  if (!id) throw new Error('vault id required for Lightning storage')
  return `${VAULT_LIGHTNING_STORAGE_PREFIX}:${encodeURIComponent(id)}:rfq-swaps`
}

function storedLightningProfile(record: RfqSwapRecord): StoredVaultLightningProfile {
  const value = record.profile[VAULT_LIGHTNING_PROFILE] as Partial<StoredVaultLightningProfile> | undefined
  const quote = value?.quote
  if (
    record.kind !== 'lightning_send' ||
    !value ||
    value.version !== VAULT_LIGHTNING_PROFILE_VERSION ||
    typeof value.invoice !== 'string' ||
    !quote ||
    quote.rfq_id !== record.rfqId ||
    !Number.isSafeInteger(quote.to_amount) ||
    !Number.isSafeInteger(quote.from_amount) ||
    !Number.isSafeInteger(quote.valid_until) ||
    !Number.isSafeInteger(quote.refund_locktime) ||
    !Number.isSafeInteger(record.amount) ||
    quote.from_amount !== record.amount ||
    !['quoted', 'funding', 'cancel_requested'].includes(String(value.fundingState))
  ) {
    throw new Error(`Stored Lightning quote ${record.rfqId} is incomplete`)
  }
  if (!['bitcoin', 'testnet', 'signet', 'mutinynet', 'regtest'].includes(String(value.network))) {
    throw new Error(`Stored Lightning quote ${record.rfqId} has no network`)
  }
  const invoice = decodeVaultLightningInvoice(value.invoice, value.network as NetworkName, 0)
  if (quote.to_amount !== invoice.amountSats) {
    throw new Error(`Stored Lightning quote ${record.rfqId} does not match its invoice`)
  }
  return value as StoredVaultLightningProfile
}

function quoteFromRecord(record: RfqSwapRecord): VaultLightningQuote {
  const stored = storedLightningProfile(record)
  const invoice = decodeVaultLightningInvoice(stored.invoice, stored.network, 0)
  const fundAmountSats = record.amount!
  return {
    kind: 'lightning',
    invoice: stored.invoice,
    invoiceAmountSats: invoice.amountSats,
    invoiceExpiresAt: invoice.expiresAt,
    rfqId: record.rfqId,
    fundAddress: record.lockupAddress,
    fundAmountSats,
    corridorFeeSats: fundAmountSats - invoice.amountSats,
    validUntil: stored.quote.valid_until,
    refundLocktime: stored.quote.refund_locktime!,
  }
}

async function retireStoredLightningQuote(
  repository: Pick<AssetSwapRepository, 'removeRfqSwap'>,
  contracts: Pick<SwapContractRegistry, 'setContractWatchState'>,
  record: RfqSwapRecord,
): Promise<void> {
  storedLightningProfile(record)
  const contractScript = hex.encode(ArkAddress.decode(record.lockupAddress).pkScript)
  await contracts.setContractWatchState(contractScript, 'retained')
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
    } catch (error) {
      if (record.kind === 'lightning_send') {
        failed.push({ rfqId: record.rfqId, error: error instanceof Error ? error : new Error(String(error)) })
      }
      continue
    }
    if (
      stored.fundingState !== 'cancel_requested' &&
      !(stored.fundingState === 'quoted' && nowSeconds >= stored.quote.valid_until)
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

export async function discardUnexposedVaultLightningQuote(
  repository: Pick<AssetSwapRepository, 'removeRfqSwap'>,
  contracts: Pick<SwapContractRegistry, 'setContractWatchState'>,
  manager: RfqSwapManager,
  rfqId: string,
  contractScript: string | undefined,
  primaryError: unknown,
): Promise<never> {
  const cleanupTasks = [manager.removeSwap(rfqId), repository.removeRfqSwap(rfqId)]
  if (contractScript) cleanupTasks.push(contracts.setContractWatchState(contractScript, 'retained'))
  const cleanup = await Promise.allSettled(cleanupTasks)
  const cleanupErrors: unknown[] = contractScript
    ? []
    : [new Error('Registered Lightning contract could not be identified')]
  cleanupErrors.push(
    ...cleanup
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason),
  )
  if (cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'Lightning quote persistence and cleanup failed')
  }
  throw primaryError
}

export async function restorePersistedVaultLightningQuote(
  repository: Pick<AssetSwapRepository, 'getRfqSwap'>,
  contracts: SwapContractRegistry,
  manager: RfqSwapManager,
  rfqId: string,
  invoice: string,
  network: NetworkName,
): Promise<VaultLightningQuote | undefined> {
  const record = await repository.getRfqSwap(rfqId)
  if (!record) return undefined
  const stored = storedLightningProfile(record)
  if (stored.network !== network) throw new Error(`Lightning request ${rfqId} belongs to another network.`)
  if (stored.invoice !== invoice) throw new Error(`Lightning request ${rfqId} belongs to another invoice.`)
  if (stored.fundingState === 'cancel_requested') throw new Error('This Lightning quote was cancelled.')
  if (isRfqSwapTerminal(record.state)) throw new Error('This Lightning payment is already resolved.')
  const params = await lockupContractParams(contracts, record.lockupAddress)
  const swap = rebuildRfqSwap(record, params)
  if (!(await manager.hasSwap(rfqId))) await manager.addSwap(swap)
  return quoteFromRecord(record)
}

export async function restoreMatchingVaultLightningQuote(
  repository: Pick<AssetSwapRepository, 'getAllRfqSwaps' | 'getRfqSwap'>,
  contracts: SwapContractRegistry,
  manager: RfqSwapManager,
  invoice: string,
  network: NetworkName,
): Promise<VaultLightningQuote | undefined> {
  const candidates = (await repository.getAllRfqSwaps())
    .filter((record) => record.kind === 'lightning_send' && !isRfqSwapTerminal(record.state))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  for (const record of candidates) {
    const stored = storedLightningProfile(record)
    if (stored.network !== network || stored.invoice !== invoice || stored.fundingState === 'cancel_requested') continue
    return restorePersistedVaultLightningQuote(repository, contracts, manager, record.rfqId, invoice, network)
  }
  return undefined
}

export async function persistVaultLightningQuote({
  result,
  facts,
  refundLocktime,
  contractParams,
  repository,
  manager,
  network,
  nowSeconds,
}: {
  result: LightningRequestResult
  facts: InvoiceFacts
  refundLocktime: number
  contractParams: Record<string, string>
  repository: AssetSwapRepository
  manager: RfqSwapManager
  network: NetworkName
  nowSeconds: number
}): Promise<VaultLightningQuote> {
  const stored: StoredVaultLightningProfile = {
    version: VAULT_LIGHTNING_PROFILE_VERSION,
    network,
    invoice: facts.raw,
    quote: result.quote,
    fundingState: 'quoted',
  }
  const swap: LightningSendSwap = {
    kind: 'lightning_send',
    rfqId: result.rfqId,
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
  const persisted = await repository.getRfqSwap(result.rfqId)
  if (!persisted) throw new Error('Lightning recovery record was not durably stored.')
  const rebuilt = rebuildRfqSwap(persisted, contractParams)
  await manager.addSwap(rebuilt)
  return quoteFromRecord(persisted)
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
  assertVaultLightningQuoteCurrent(quoteFromRecord(record), nowSeconds)
  if (stored.fundingState === 'quoted') {
    await repository.saveRfqSwap({
      ...record,
      profile: {
        ...record.profile,
        [VAULT_LIGHTNING_PROFILE]: { ...stored, fundingState: 'funding' },
      },
    })
    const persisted = await repository.getRfqSwap(rfqId)
    if (!persisted || storedLightningProfile(persisted).fundingState !== 'funding') {
      throw new Error('Lightning funding permission was not durably stored. Do not fund this quote.')
    }
  }
  return { rfqId, address: record.lockupAddress, amountSats: record.amount! }
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

export function getVaultLightningStatus(
  repository: Pick<AssetSwapRepository, 'getRfqSwap'>,
  rfqId: string,
): Promise<RfqSwapRecord | undefined> {
  return repository.getRfqSwap(rfqId)
}

export async function listVaultLightningHistory(
  repository: Pick<AssetSwapRepository, 'getAllRfqSwaps'>,
): Promise<VaultLightningHistoryMetadata[]> {
  const payments: VaultLightningHistoryMetadata[] = []
  for (const record of await repository.getAllRfqSwaps()) {
    if (record.kind !== 'lightning_send' || !record.fundingArkTxid) continue
    if (!/^[0-9a-f]{64}$/.test(record.fundingArkTxid)) {
      throw new Error(`Stored Lightning payment ${record.rfqId} has an invalid funding transaction id`)
    }
    const quote = quoteFromRecord(record)
    payments.push({
      txid: record.fundingArkTxid,
      invoiceAmountSats: quote.invoiceAmountSats,
      state: record.state,
    })
  }
  return payments
}

export function assertVaultLightningQuoteCurrent(
  quote: VaultLightningQuote,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (nowSeconds >= quote.invoiceExpiresAt) throw new Error('This Lightning invoice has expired.')
  if (nowSeconds >= quote.validUntil) throw new Error('This Lightning quote has expired. Return to Send and try again.')
}

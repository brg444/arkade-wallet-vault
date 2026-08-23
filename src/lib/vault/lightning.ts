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
import { requestLightningSend, type InvoiceFacts, type RfqTransport } from '@arkade-os/swap'
import { nostrRfqTransport } from '@arkade-os/swap/nostr'
import { hex } from '@scure/base'
import bolt11 from 'light-bolt11-decoder'
import type { VaultStatus } from './types'
import { createVaultBoardingStorage, disposeVaultBoardingResources } from './vtxo/board'

const LIGHTNING_SEND_RELEASE_FLAG = 'true'

/**
 * The signed production card bundled by the official Arkade Wallet at
 * arkade-os/wallet@60cc144. The public registry currently advertises no
 * mainnet Lightning market, so this is deliberately a release pin rather than
 * network discovery pretending to have found one.
 */
export const MAINNET_LIGHTNING_SOLVER = {
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
  lockupAddress: string
  fundAmountSats: number
  corridorFeeSats: number
  validUntil: number
  refundLocktime: number
  refundAddress: string
  swapPkScript: string
}

export class LightningInvoiceRejected extends Error {
  constructor(
    readonly reason: 'unparseable' | 'wrong_network' | 'expired' | 'zero_amount' | 'no_payment_hash',
    message: string,
  ) {
    super(message)
    this.name = 'LightningInvoiceRejected'
  }
}

export function vaultLightningSendEnabled(value = import.meta.env.VITE_VAULT_LIGHTNING_SEND): boolean {
  return value === LIGHTNING_SEND_RELEASE_FLAG
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
  const amountSats = Math.floor(amountMillisats / 1000)

  if (prefix !== NETWORK_PREFIX[network]) {
    throw new LightningInvoiceRejected('wrong_network', `This invoice is not for ${network}.`)
  }
  if (!timestamp || nowSeconds >= expiresAt) {
    throw new LightningInvoiceRejected('expired', 'This Lightning invoice has expired.')
  }
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new LightningInvoiceRejected('zero_amount', 'Enter a Lightning invoice with an amount.')
  }
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

type VaultSdkWalletResources = {
  walletRepository: IndexedDBWalletRepository
  contractRepository: IndexedDBContractRepository
  intentRepository: IndexedDBIntentRepository
}

export async function withVaultLightningSdkWallet<T>(
  phoneSecret: Uint8Array,
  status: VaultStatus,
  arkServerUrl: string,
  run: (wallet: IWallet) => Promise<T>,
): Promise<T> {
  if (!status.spendingArkAddress) throw new Error('Vault has no Spending address.')
  const identity = SingleKey.fromPrivateKey(phoneSecret)
  if (hex.encode(await identity.compressedPublicKey()) !== String(status.phoneBip340Pub || '')) {
    throw new Error('Phone key does not match this vault.')
  }
  const storage: VaultSdkWalletResources = createVaultBoardingStorage(status.vaultId)
  const operator = new RestArkProvider(arkServerUrl)
  let wallet: Wallet | undefined
  let primaryError: unknown
  try {
    const info = await operator.getInfo()
    if (info.network !== status.network) throw new Error('Vault and Arkade Operator networks do not match.')
    const refund = ArkAddress.decode(status.spendingArkAddress)
    const expectedHrp = info.network === 'bitcoin' ? 'ark' : 'tark'
    if (refund.hrp !== expectedHrp) throw new Error('Spending refund address is encoded for another network.')
    const signer = hex.decode(info.signerPubkey)
    const xOnlySigner = signer.length === 33 ? signer.slice(1) : signer
    if (hex.encode(refund.serverPubKey) !== hex.encode(xOnlySigner)) {
      throw new Error('Spending refund address belongs to another Arkade Operator.')
    }
    wallet = await Wallet.create({
      identity,
      arkServerUrl,
      arkProvider: operator,
      indexerProvider: new RestIndexerProvider(arkServerUrl),
      settlementConfig: false,
      storage,
    })
    return await run(withVaultRefundAddress(wallet, status.spendingArkAddress))
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      await disposeVaultBoardingResources(wallet, storage)
    } catch (cleanupError) {
      if (primaryError !== undefined) {
        throw new AggregateError([primaryError, cleanupError], 'Lightning request and SDK cleanup failed')
      }
      throw cleanupError
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
  requester = requestLightningSend,
  nowSeconds = Math.floor(Date.now() / 1000),
  enabled = vaultLightningSendEnabled(),
}: {
  wallet: IWallet
  arkServerUrl: string
  invoice: string
  network: NetworkName
  transport: RfqTransport
  requester?: LightningRequester
  nowSeconds?: number
  enabled?: boolean
}): Promise<VaultLightningQuote> {
  if (!enabled) throw new Error('Lightning send is not enabled in this release.')
  if (network !== 'bitcoin') throw new Error('Lightning send is enabled for mainnet only.')
  const facts = decodeVaultLightningInvoice(invoice, network, nowSeconds)
  if (facts.amountSats < MAINNET_LIGHTNING_SOLVER.minSats || facts.amountSats > MAINNET_LIGHTNING_SOLVER.maxSats) {
    throw new Error(
      `Lightning amount must be ${MAINNET_LIGHTNING_SOLVER.minSats.toLocaleString()}–${MAINNET_LIGHTNING_SOLVER.maxSats.toLocaleString()} sats.`,
    )
  }
  const result = await requester(wallet, arkServerUrl, transport, { invoice: facts })
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
  return {
    kind: 'lightning',
    invoice: facts.raw,
    invoiceAmountSats: facts.amountSats,
    invoiceExpiresAt: facts.expiresAt,
    rfqId: result.rfqId,
    lockupAddress: result.address,
    fundAmountSats: result.fundAmount,
    corridorFeeSats: result.fundAmount - facts.amountSats,
    validUntil: result.quote.valid_until,
    refundLocktime,
    refundAddress,
    swapPkScript: hex.encode(result.swapPkScript),
  }
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
    relays: [...MAINNET_LIGHTNING_SOLVER.relays],
    solverPubkey: MAINNET_LIGHTNING_SOLVER.pubkey,
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

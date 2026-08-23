import { ArkAddress, VHTLCV2ContractHandler, type IWallet, type NetworkName } from '@arkade-os/sdk'
import {
  lockupContractParams,
  requestLightningSend,
  type InvoiceFacts,
  type SwapContractRegistry,
} from '@arkade-os/swap'
import { hex } from '@scure/base'
import bolt11 from 'light-bolt11-decoder'

const NETWORK_PREFIX: Record<NetworkName, string> = {
  bitcoin: 'bc',
  testnet: 'tb',
  signet: 'tbs',
  mutinynet: 'tbs',
  regtest: 'bcrt',
}

export type LightningRequestResult = Awaited<ReturnType<typeof requestLightningSend>>

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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameContractParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export function registeredContractScript(result: LightningRequestResult): string | undefined {
  try {
    return hex.encode(result.script.pkScript)
  } catch {
    try {
      return hex.encode(ArkAddress.decode(result.address).pkScript)
    } catch {
      return undefined
    }
  }
}

export async function validateVaultLightningRequestResult({
  result,
  rfqId,
  facts,
  wallet,
  contracts,
  nowSeconds,
}: {
  result: LightningRequestResult
  rfqId: string
  facts: InvoiceFacts
  wallet: IWallet
  contracts: SwapContractRegistry
  nowSeconds: number
}): Promise<{ contractParams: Record<string, string>; refundLocktime: number }> {
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
  if (!Number.isSafeInteger(refundLocktime)) throw new Error('Lightning quote has no refund time.')
  if (result.refundAddress !== (await wallet.getAddress())) {
    throw new Error('Lightning quote changed the Vault refund address.')
  }
  const senderPubkey = hex.encode(result.senderPubkey)
  if (
    senderPubkey !== hex.encode(result.treeParams.senderPubkey) ||
    senderPubkey !== hex.encode(result.secrets.pubkey)
  ) {
    throw new Error('Lightning refund signer changed during quote construction.')
  }
  if (!(result.swapPkScript instanceof Uint8Array) || !sameBytes(result.swapPkScript, result.script.pkScript)) {
    throw new Error('Lightning lockup script changed during quote construction.')
  }

  const contractParams = await lockupContractParams(contracts, result.address)
  const expected = VHTLCV2ContractHandler.serializeParams(result.script.options)
  if (!sameContractParams(contractParams, expected)) {
    throw new Error('Persisted Lightning contract does not contain the quoted recovery tree.')
  }
  return { contractParams, refundLocktime }
}

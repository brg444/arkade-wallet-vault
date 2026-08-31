import { ArkAddress, VHTLCV2ContractHandler, type IWallet } from '@arkade-os/sdk'
import {
  lockupContractParams,
  requestLightningSend,
  type InvoiceFacts,
  type SwapContractRegistry,
} from '@arkade-os/swap'
import { hex } from '@scure/base'

export type LightningRequestResult = Awaited<ReturnType<typeof requestLightningSend>>

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

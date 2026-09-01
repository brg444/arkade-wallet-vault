import { ArkAddress, VHTLCV2ContractHandler } from '@arkade-os/sdk'
import { lockupContractParams, requestLightningSend, type SwapContractRegistry } from '@arkade-os/swap'
import { hex } from '@scure/base'

export type LightningRequestResult = Awaited<ReturnType<typeof requestLightningSend>>

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

export async function readRegisteredLightningContractParams({
  result,
  contracts,
}: {
  result: LightningRequestResult
  contracts: SwapContractRegistry
}): Promise<Record<string, string>> {
  const contractParams = await lockupContractParams(contracts, result.address)
  const expected = VHTLCV2ContractHandler.serializeParams(result.script.options)
  if (!sameContractParams(contractParams, expected)) {
    throw new Error('Persisted Lightning contract does not contain the quoted recovery tree.')
  }
  return contractParams
}

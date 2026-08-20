import {
  contractHandlers,
  sequenceToTimelock,
  timelockToSequence,
  type ContractHandler,
  type PathContext,
  type PathSelection,
} from '@arkade-os/sdk'
import { hex } from '@scure/base'
import {
  assertVaultPolicyV1Params,
  VAULT_POLICY_V1_EXIT_DELAY,
  VAULT_POLICY_V1_EXIT_DELAY_UNIT,
  VAULT_POLICY_V1_TYPE,
  VaultPolicyV1Script,
  type VaultPolicyV1Params,
} from './script'

const REQUIRED_PUBS = [
  'userPub',
  'vtxoVaultCosignerPub',
  'tweakedEmulatorPub',
  'arkdServerPub',
  'delegatePub',
  'exitDevicePub',
  'exitHardwarePub',
] as const

/** DefaultVtxo / DelegateVtxo serialized keys. Never accepted as vault-policy-v1. */
const FOREIGN_CONTRACT_KEYS = ['pubKey', 'serverPubKey', 'delegatePubKey', 'csvTimelock'] as const

function refuseForeignContractParams(params: Record<string, string>) {
  for (const key of FOREIGN_CONTRACT_KEYS) {
    if (params[key] !== undefined) {
      throw new Error('vault-policy-v1 refuses DefaultVtxo / DelegateVtxo params')
    }
  }
}

function decodeXOnlyHex(value: string | undefined, name: string): Uint8Array {
  if (!value) throw new Error(`${name} is required`)
  let bytes: Uint8Array
  try {
    bytes = hex.decode(value)
  } catch {
    throw new Error(`${name} must be hex`)
  }
  if (bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) {
    return bytes.subarray(1)
  }
  if (bytes.length !== 32) {
    throw new Error(`${name} must be a 32-byte x-only pubkey`)
  }
  return bytes
}

export function serializeParams(params: VaultPolicyV1Params): Record<string, string> {
  const typed = assertVaultPolicyV1Params(params)
  const out: Record<string, string> = {
    userPub: hex.encode(typed.userPub),
    vtxoVaultCosignerPub: hex.encode(typed.vtxoVaultCosignerPub),
    tweakedEmulatorPub: hex.encode(typed.tweakedEmulatorPub),
    arkdServerPub: hex.encode(typed.arkdServerPub),
    delegatePub: hex.encode(typed.delegatePub),
    exitDelay: typed.exitDelay.toString(),
    exitDelayUnit: typed.exitDelayUnit,
    exitDevicePub: hex.encode(typed.exitDevicePub),
    exitHardwarePub: hex.encode(typed.exitHardwarePub),
  }
  if (typed.exitRecoveryPub) out.exitRecoveryPub = hex.encode(typed.exitRecoveryPub)
  return out
}

export function deserializeParams(params: Record<string, string>): VaultPolicyV1Params {
  refuseForeignContractParams(params)
  const missing = REQUIRED_PUBS.filter((name) => !params[name])
  if (missing.length > 0) {
    throw new Error(`vault-policy-v1 missing pubs: ${missing.join(', ')}`)
  }

  const exitDelay = params.exitDelay === undefined ? VAULT_POLICY_V1_EXIT_DELAY : BigInt(params.exitDelay)
  const exitDelayUnit = params.exitDelayUnit === undefined ? VAULT_POLICY_V1_EXIT_DELAY_UNIT : params.exitDelayUnit

  return assertVaultPolicyV1Params({
    userPub: decodeXOnlyHex(params.userPub, 'userPub'),
    vtxoVaultCosignerPub: decodeXOnlyHex(params.vtxoVaultCosignerPub, 'vtxoVaultCosignerPub'),
    tweakedEmulatorPub: decodeXOnlyHex(params.tweakedEmulatorPub, 'tweakedEmulatorPub'),
    arkdServerPub: decodeXOnlyHex(params.arkdServerPub, 'arkdServerPub'),
    delegatePub: decodeXOnlyHex(params.delegatePub, 'delegatePub'),
    exitDelay,
    exitDelayUnit: exitDelayUnit as typeof VAULT_POLICY_V1_EXIT_DELAY_UNIT,
    exitDevicePub: decodeXOnlyHex(params.exitDevicePub, 'exitDevicePub'),
    exitHardwarePub: decodeXOnlyHex(params.exitHardwarePub, 'exitHardwarePub'),
    exitRecoveryPub: params.exitRecoveryPub ? decodeXOnlyHex(params.exitRecoveryPub, 'exitRecoveryPub') : undefined,
  })
}

function isCsvSpendable(context: PathContext, sequence: number | undefined): boolean {
  if (sequence === undefined) return true
  if (!context.vtxo) return false
  const timelock = sequenceToTimelock(sequence)
  if (timelock.type === 'blocks') {
    if (context.blockHeight === undefined || context.vtxo.status.block_height === undefined) {
      return false
    }
    return context.blockHeight - context.vtxo.status.block_height >= Number(timelock.value)
  }
  if (timelock.type === 'seconds') {
    const blockTime = context.vtxo.status.block_time
    if (blockTime === undefined) return false
    return context.currentTime / 1e3 - blockTime >= Number(timelock.value)
  }
  return false
}

export function vaultPolicyV1ExitSequence(): number {
  return timelockToSequence({ type: VAULT_POLICY_V1_EXIT_DELAY_UNIT, value: VAULT_POLICY_V1_EXIT_DELAY })
}

export const VaultPolicyV1Handler: ContractHandler<VaultPolicyV1Params, VaultPolicyV1Script> = {
  type: VAULT_POLICY_V1_TYPE,
  createScript(params) {
    return new VaultPolicyV1Script(this.deserializeParams(params))
  },
  serializeParams,
  deserializeParams,
  selectPath(script, _contract, context) {
    if (context.collaborative) return { leaf: script.spend() }
    const sequence = vaultPolicyV1ExitSequence()
    if (isCsvSpendable(context, sequence)) return { leaf: script.exit(), sequence }
    return null
  },
  getAllSpendingPaths(script, _contract, context) {
    const paths: PathSelection[] = []
    if (context.collaborative) paths.push({ leaf: script.spend() })
    paths.push({ leaf: script.exit(), sequence: vaultPolicyV1ExitSequence() })
    return paths
  },
  getSpendablePaths(script, _contract, context) {
    const paths: PathSelection[] = []
    if (context.collaborative) paths.push({ leaf: script.spend() })
    const sequence = vaultPolicyV1ExitSequence()
    if (isCsvSpendable(context, sequence)) paths.push({ leaf: script.exit(), sequence })
    return paths
  },
}

if (!contractHandlers.has(VaultPolicyV1Handler.type)) {
  contractHandlers.register(VaultPolicyV1Handler)
}

import { CSVMultisigTapscript, MultisigTapscript, VtxoScript, type TapLeafScript } from '@arkade-os/sdk'
import { hex } from '@scure/base'

export const VAULT_POLICY_V1_TYPE = 'vault-policy-v1'

/** Unilateral exit delay, frozen at 2048 seconds. */
export const VAULT_POLICY_V1_EXIT_DELAY = 2048n
export const VAULT_POLICY_V1_EXIT_DELAY_UNIT = 'seconds' as const

/** OP_TUNNEL = 0xf7 */
export const OP_TUNNEL = 0xf7

/** `<0> OP_TUNNEL` — Arkade packet script / tweak preimage, not a tapleaf. */
export const TUNNEL_ARK_SCRIPT = new Uint8Array([0x00, OP_TUNNEL])

export interface VaultPolicyV1Params {
  userPub: Uint8Array
  vtxoVaultCosignerPub: Uint8Array
  tweakedEmulatorPub: Uint8Array
  arkdServerPub: Uint8Array
  tweakedTunnelEmulatorPub: Uint8Array
  exitDelay: bigint
  exitDelayUnit: typeof VAULT_POLICY_V1_EXIT_DELAY_UNIT
  exitDevicePub: Uint8Array
  exitHardwarePub: Uint8Array
  exitRecoveryPub?: Uint8Array
}

function requireXOnly(value: Uint8Array | undefined, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`${name} must be a 32-byte x-only pubkey`)
  }
  return value
}

export function assertVaultPolicyV1Params(params: VaultPolicyV1Params): VaultPolicyV1Params {
  const userPub = requireXOnly(params.userPub, 'userPub')
  const vtxoVaultCosignerPub = requireXOnly(params.vtxoVaultCosignerPub, 'vtxoVaultCosignerPub')
  const tweakedEmulatorPub = requireXOnly(params.tweakedEmulatorPub, 'tweakedEmulatorPub')
  const arkdServerPub = requireXOnly(params.arkdServerPub, 'arkdServerPub')
  const tweakedTunnelEmulatorPub = requireXOnly(params.tweakedTunnelEmulatorPub, 'tweakedTunnelEmulatorPub')
  const exitDevicePub = requireXOnly(params.exitDevicePub, 'exitDevicePub')
  const exitHardwarePub = requireXOnly(params.exitHardwarePub, 'exitHardwarePub')
  const exitRecoveryPub = params.exitRecoveryPub ? requireXOnly(params.exitRecoveryPub, 'exitRecoveryPub') : undefined

  if (params.exitDelay !== VAULT_POLICY_V1_EXIT_DELAY || params.exitDelayUnit !== VAULT_POLICY_V1_EXIT_DELAY_UNIT) {
    throw new Error('vault-policy-v1 exit delay is frozen at 2048 seconds')
  }

  return {
    userPub,
    vtxoVaultCosignerPub,
    tweakedEmulatorPub,
    arkdServerPub,
    tweakedTunnelEmulatorPub,
    exitDelay: VAULT_POLICY_V1_EXIT_DELAY,
    exitDelayUnit: VAULT_POLICY_V1_EXIT_DELAY_UNIT,
    exitDevicePub,
    exitHardwarePub,
    ...(exitRecoveryPub ? { exitRecoveryPub } : {}),
  }
}

/**
 * vault-policy-v1 tap tree: 4-pub spend, guardian CSV exit, tunnel 2-of-2.
 * Tunnel is a bitcoin tapleaf only; `<0> OP_TUNNEL` is a different ArkScript tweak.
 */
export class VaultPolicyV1Script extends VtxoScript {
  readonly params: VaultPolicyV1Params
  readonly spendScript: string
  readonly exitScript: string
  readonly tunnelScript: string

  constructor(params: VaultPolicyV1Params) {
    const typed = assertVaultPolicyV1Params(params)
    const spend = MultisigTapscript.encode({
      pubkeys: [typed.userPub, typed.vtxoVaultCosignerPub, typed.tweakedEmulatorPub, typed.arkdServerPub],
    })
    const exit = CSVMultisigTapscript.encode({
      timelock: { type: typed.exitDelayUnit, value: typed.exitDelay },
      pubkeys: typed.exitRecoveryPub
        ? [typed.exitHardwarePub, typed.exitRecoveryPub]
        : [typed.exitDevicePub, typed.exitHardwarePub],
    })
    const tunnel = MultisigTapscript.encode({
      pubkeys: [typed.tweakedTunnelEmulatorPub, typed.arkdServerPub],
    })
    super([spend.script, exit.script, tunnel.script])
    this.params = typed
    this.spendScript = hex.encode(spend.script)
    this.exitScript = hex.encode(exit.script)
    this.tunnelScript = hex.encode(tunnel.script)
  }

  spend(): TapLeafScript {
    return this.findLeaf(this.spendScript)
  }

  exit(): TapLeafScript {
    return this.findLeaf(this.exitScript)
  }

  tunnel(): TapLeafScript {
    return this.findLeaf(this.tunnelScript)
  }
}

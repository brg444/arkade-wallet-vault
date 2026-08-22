import { schnorr } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import type { IntentFeeConfig } from '@arkade-os/sdk'

export const ARKADE_INTENT_FEE_POLICY_TAG = 'arkade-vault/arkade-intent-fee-policy/v1'

export interface CompleteIntentFeePolicy {
  offchainInput: string
  offchainOutput: string
  onchainInput: string
  onchainOutput: string
}

const POLICY_FIELDS = ['offchainInput', 'offchainOutput', 'onchainInput', 'onchainOutput'] as const
const encoder = new TextEncoder()

function field(value: string): Uint8Array {
  const encoded = encoder.encode(value)
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, encoded.length, true)
  const out = new Uint8Array(length.length + encoded.length)
  out.set(length)
  out.set(encoded, length.length)
  return out
}

export function requireCompleteIntentFeePolicy(config: IntentFeeConfig): CompleteIntentFeePolicy {
  const raw = config as Record<string, unknown>
  for (const name of POLICY_FIELDS) {
    if (typeof raw[name] !== 'string') throw new Error(`Operator fee policy is missing ${name}`)
  }
  return {
    offchainInput: raw.offchainInput as string,
    offchainOutput: raw.offchainOutput as string,
    onchainInput: raw.onchainInput as string,
    onchainOutput: raw.onchainOutput as string,
  }
}

export function arkadeIntentFeePolicyDigest(config: IntentFeeConfig): string {
  const policy = requireCompleteIntentFeePolicy(config)
  return hex.encode(
    schnorr.utils.taggedHash(ARKADE_INTENT_FEE_POLICY_TAG, ...POLICY_FIELDS.map((name) => field(policy[name]))),
  )
}

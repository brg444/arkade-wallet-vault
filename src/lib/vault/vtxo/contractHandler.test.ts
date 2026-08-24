import { SingleKey } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import {
  VaultPolicyV1ContractHandler,
  registerVaultPolicyV1ContractHandler,
  vaultPolicyV1Contract,
} from './contractHandler'
import {
  VAULT_POLICY_V1_EXIT_DELAY,
  VAULT_POLICY_V1_EXIT_DELAY_UNIT,
  VaultPolicyV1Script,
  pinnedDelegateXOnly,
} from './script'

async function publicKey(secret: number) {
  return (
    await SingleKey.fromPrivateKey(hex.decode(secret.toString(16).padStart(64, '0'))).compressedPublicKey()
  ).slice(1)
}

describe('vault-policy-v1 SDK contract handler', () => {
  it('round-trips the exact script while keeping Vault funds out of generic SDK selection', async () => {
    const params = {
      userPub: await publicKey(1),
      vtxoVaultCosignerPub: await publicKey(2),
      arkdServerPub: await publicKey(3),
      delegatePub: pinnedDelegateXOnly(),
      exitDelay: VAULT_POLICY_V1_EXIT_DELAY,
      exitDelayUnit: VAULT_POLICY_V1_EXIT_DELAY_UNIT,
      exitDevicePub: await publicKey(4),
      exitHardwarePub: await publicKey(5),
      exitRecoveryPub: await publicKey(6),
    }
    const expected = new VaultPolicyV1Script(params)
    const serialized = VaultPolicyV1ContractHandler.serializeParams(params)
    const restored = VaultPolicyV1ContractHandler.createScript(serialized)

    expect(hex.encode(restored.pkScript)).toBe(hex.encode(expected.pkScript))
    expect(
      VaultPolicyV1ContractHandler.isGenericallySpendable?.(vaultPolicyV1Contract(expected, 'tark1test') as never),
    ).toBe(false)
    expect(VaultPolicyV1ContractHandler.getSpendablePaths(restored, {} as never, {} as never)).toEqual([])
  })

  it('registers idempotently in page and worker realms', () => {
    expect(() => {
      registerVaultPolicyV1ContractHandler()
      registerVaultPolicyV1ContractHandler()
    }).not.toThrow()
  })
})

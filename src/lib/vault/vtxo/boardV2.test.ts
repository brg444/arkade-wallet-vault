import 'fake-indexeddb/auto'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { createBoardingProgramScript, getNetwork } from '@arkade-os/sdk'
import { describe, expect, it } from 'vitest'
import type { VaultBoardV2Descriptor } from '../types'
import {
  activateVaultBoardV2Key,
  deleteVaultBoardV2Key,
  deriveVaultBoardV2Key,
  MUTINYNET_OPERATOR_SIGNER_PUB,
  requireVaultBoardV2Descriptor,
  stageVaultBoardV2Key,
  VAULT_BOARD_V2_EXIT_DELAY,
  VAULT_BOARD_V2_EXIT_DELAY_UNIT,
  VAULT_BOARD_V2_PROGRAM,
  VAULT_BOARD_V2_SCHEMA,
  VAULT_BOARD_V2_TEMPLATE,
} from './boardV2'

function compressedSecret(value: number) {
  const secret = new Uint8Array(32)
  secret[31] = value
  return hex.encode(secp256k1.getPublicKey(secret, true))
}

function descriptor(): { descriptor: VaultBoardV2Descriptor; phonePub: string; boardingPub: string } {
  const boardingPub = compressedSecret(1)
  const phonePub = compressedSecret(2)
  const cosignerPub = compressedSecret(3)
  const program = createBoardingProgramScript(
    {
      name: VAULT_BOARD_V2_PROGRAM,
      boardingPubKey: hex.decode(boardingPub).slice(1),
      cosignerPubKey: hex.decode(cosignerPub).slice(1),
      recoveryPubKey: hex.decode(phonePub).slice(1),
    },
    hex.decode(MUTINYNET_OPERATOR_SIGNER_PUB).slice(1),
    { type: 'seconds', value: BigInt(VAULT_BOARD_V2_EXIT_DELAY) },
  )
  return {
    boardingPub,
    phonePub,
    descriptor: {
      schema: VAULT_BOARD_V2_SCHEMA,
      program: VAULT_BOARD_V2_PROGRAM,
      template: VAULT_BOARD_V2_TEMPLATE,
      network: 'mutinynet',
      boardingPub,
      recoveryPhonePub: phonePub,
      vaultBoardCosignerPub: cosignerPub,
      operatorPub: MUTINYNET_OPERATOR_SIGNER_PUB,
      exitDelay: VAULT_BOARD_V2_EXIT_DELAY,
      exitDelayUnit: VAULT_BOARD_V2_EXIT_DELAY_UNIT,
      script: hex.encode(program.pkScript),
      address: program.onchainAddress(getNetwork('mutinynet')),
    },
  }
}

describe('vault-board-v2 program binding', () => {
  it('accepts only the exact reconstructed release program', () => {
    const fixture = descriptor()
    expect(
      requireVaultBoardV2Descriptor(fixture.descriptor, {
        vaultId: 'vault-a',
        phonePub: fixture.phonePub,
        boardingPub: fixture.boardingPub,
        network: 'mutinynet',
      }),
    ).toEqual(fixture.descriptor)
  })

  it.each([
    ['script', (value: VaultBoardV2Descriptor) => ({ ...value, script: `${value.script.slice(0, -2)}00` })],
    ['address', (value: VaultBoardV2Descriptor) => ({ ...value, address: `${value.address}x` })],
    ['role', (value: VaultBoardV2Descriptor) => ({ ...value, vaultBoardCosignerPub: compressedSecret(4) })],
    ['collision', (value: VaultBoardV2Descriptor) => ({ ...value, vaultBoardCosignerPub: value.boardingPub })],
    ['CSV', (value: VaultBoardV2Descriptor) => ({ ...value, exitDelay: value.exitDelay - 1 })],
    ['Operator', (value: VaultBoardV2Descriptor) => ({ ...value, operatorPub: compressedSecret(5) })],
  ])('rejects a mutated %s', (_name, mutate) => {
    const fixture = descriptor()
    expect(() =>
      requireVaultBoardV2Descriptor(mutate(fixture.descriptor), {
        vaultId: 'vault-a',
        phonePub: fixture.phonePub,
        boardingPub: fixture.boardingPub,
        network: 'mutinynet',
      }),
    ).toThrow()
  })

  it('derives one deterministic, even-Y key per vault and network binding', async () => {
    const phoneSecret = new Uint8Array(32)
    phoneSecret[31] = 7
    const first = await deriveVaultBoardV2Key(phoneSecret, 'vault-a', 'mutinynet')
    const again = await deriveVaultBoardV2Key(phoneSecret, 'vault-a', 'mutinynet')
    const other = await deriveVaultBoardV2Key(phoneSecret, 'vault-b', 'mutinynet')
    try {
      expect(first.boardingPub).toBe(again.boardingPub)
      expect(first.boardingPub.startsWith('02')).toBe(true)
      expect(other.boardingPub).not.toBe(first.boardingPub)
    } finally {
      first.secret.fill(0)
      again.secret.fill(0)
      other.secret.fill(0)
      phoneSecret.fill(0)
    }
  })

  it('accepts an already-active exact key but rejects an activation mismatch', async () => {
    const vaultId = 'vault-board-activation'
    const descriptorHash = 'ab'.repeat(32)
    const phoneSecret = new Uint8Array(32)
    phoneSecret[31] = 7
    try {
      const staged = await stageVaultBoardV2Key({ vaultId, phoneSecret, network: 'mutinynet' })
      await activateVaultBoardV2Key({
        vaultId,
        descriptorHash,
        expectedBoardingPub: staged.boardingPub,
      })
      await expect(
        activateVaultBoardV2Key({ vaultId, descriptorHash, expectedBoardingPub: staged.boardingPub }),
      ).resolves.toBeUndefined()
      await expect(
        activateVaultBoardV2Key({
          vaultId,
          descriptorHash: 'cd'.repeat(32),
          expectedBoardingPub: staged.boardingPub,
        }),
      ).rejects.toThrow(/active vault-board-v2 key does not match descriptor/)
    } finally {
      phoneSecret.fill(0)
      await deleteVaultBoardV2Key(vaultId)
    }
  })
})

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { createBoardingProgramScript, getNetwork, type ExtendedCoin, type OnchainProvider } from '@arkade-os/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { EnrollmentSecrets } from '../tenantEnrollment'
import type { BoardingDescriptor, VaultStatus } from '../types'
import {
  MUTINYNET_OPERATOR_SIGNER_PUB,
  BOARDING_EXIT_DELAY,
  BOARDING_EXIT_DELAY_UNIT,
  BOARDING_PROGRAM,
  BOARDING_SCHEMA,
  BOARDING_TEMPLATE,
} from './board'
import { findMatureBoardingInputs, recoverMatureBoardingInputs } from './boardingRecovery'
import type { VaultLockManager } from './lock'

const availableLocks: VaultLockManager = {
  request: async (_name, _options, run) => run({ held: true }),
}

const secret = (value: number) => {
  const out = new Uint8Array(32)
  out[31] = value
  return out
}

function fixture() {
  const boardingSecret = secret(1)
  const phoneSecret = secret(2)
  const cosignerSecret = secret(3)
  const boardingPub = hex.encode(secp256k1.getPublicKey(boardingSecret, true))
  const phonePub = hex.encode(secp256k1.getPublicKey(phoneSecret, true))
  const cosignerPub = hex.encode(secp256k1.getPublicKey(cosignerSecret, true))
  boardingSecret.fill(0)
  cosignerSecret.fill(0)
  const program = createBoardingProgramScript(
    {
      name: BOARDING_PROGRAM,
      boardingPubKey: hex.decode(boardingPub).slice(1),
      cosignerPubKey: hex.decode(cosignerPub).slice(1),
      recoveryPubKey: hex.decode(phonePub).slice(1),
    },
    hex.decode(MUTINYNET_OPERATOR_SIGNER_PUB).slice(1),
    { type: 'seconds', value: BigInt(BOARDING_EXIT_DELAY) },
  )
  const descriptor: BoardingDescriptor = {
    schema: BOARDING_SCHEMA,
    program: BOARDING_PROGRAM,
    template: BOARDING_TEMPLATE,
    network: 'mutinynet',
    boardingPub,
    recoveryPhonePub: phonePub,
    vaultBoardCosignerPub: cosignerPub,
    operatorPub: MUTINYNET_OPERATOR_SIGNER_PUB,
    exitDelay: BOARDING_EXIT_DELAY,
    exitDelayUnit: BOARDING_EXIT_DELAY_UNIT,
    script: hex.encode(program.pkScript),
    address: program.onchainAddress(getNetwork('mutinynet')),
  }
  const status = {
    enrolled: true,
    vaultId: 'vault-recovery',
    network: 'mutinynet',
    phoneBip340Pub: phonePub,
    vtxoBoardingActive: true,
    vtxoBoardingProgram: BOARDING_PROGRAM,
    vtxoBoardingDescriptor: descriptor,
    vtxoBoardingDescriptorHash: 'ab'.repeat(32),
    vtxoBoardingScript: descriptor.script,
    vtxoBoardingAddress: descriptor.address,
    vtxoBoardingExitDelay: BOARDING_EXIT_DELAY,
    vtxoBoardingExitDelayUnit: BOARDING_EXIT_DELAY_UNIT,
    feerateCapSatVb: 10,
    absoluteFeeCap: 2_000,
  } as VaultStatus
  const mature = {
    txid: '11'.repeat(32),
    vout: 0,
    value: 100_000,
    status: {
      confirmed: true,
      block_height: 1,
      block_time: Math.floor(Date.now() / 1000) - BOARDING_EXIT_DELAY - 1,
    },
    tapTree: program.encode(),
    forfeitTapLeafScript: [] as never,
    intentTapLeafScript: [] as never,
  } satisfies ExtendedCoin
  const enrollment = { vaultId: status.vaultId } as EnrollmentSecrets
  return { descriptor, enrollment, mature, phoneSecret, program, status }
}

describe('vault-board-v1 one-shot recovery', () => {
  it('discovers only current exact-program confirmed matured inputs', async () => {
    const { mature, status } = fixture()
    const immature = {
      ...mature,
      txid: '22'.repeat(32),
      status: { ...mature.status, block_time: Math.floor(Date.now() / 1000) },
    }
    const unconfirmed = { ...mature, txid: '33'.repeat(32), status: { confirmed: false as const } }
    const foreign = { ...mature, txid: '44'.repeat(32), tapTree: new Uint8Array(mature.tapTree.length) }

    await expect(
      findMatureBoardingInputs(status, {
        getBoardingUtxos: async () => [immature, unconfirmed, foreign, mature],
      }),
    ).resolves.toEqual({ inputs: [mature], totalSats: mature.value })
  })

  it('uses the SDK recovery helper with release fee caps and zeros the phone scalar', async () => {
    const { enrollment, mature, phoneSecret, status } = fixture()
    const recover = vi.fn().mockResolvedValue('55'.repeat(32))

    await expect(
      recoverMatureBoardingInputs(enrollment, status, {
        getBoardingUtxos: async () => [mature],
        unlockPhone: async () => phoneSecret,
        recover,
        onchainProvider: {} as OnchainProvider,
        locks: availableLocks,
      }),
    ).resolves.toBe('55'.repeat(32))
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: [mature],
        maxFeeRateSatVb: 10,
        absoluteFeeCapSats: 2_000n,
      }),
    )
    expect(phoneSecret.every((value) => value === 0)).toBe(true)
  })

  it('does not sign or broadcast when Face ID is cancelled', async () => {
    const { enrollment, mature, status } = fixture()
    const recover = vi.fn()
    await expect(
      recoverMatureBoardingInputs(enrollment, status, {
        getBoardingUtxos: async () => [mature],
        unlockPhone: async () => {
          throw new Error('The operation was aborted.')
        },
        recover,
        locks: availableLocks,
      }),
    ).rejects.toThrow(/aborted/)
    expect(recover).not.toHaveBeenCalled()
  })

  it('refuses a second recovery action while broadcast is in flight', async () => {
    const { enrollment, mature, phoneSecret, status } = fixture()
    let finish!: (txid: string) => void
    const recover = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    const first = recoverMatureBoardingInputs(enrollment, status, {
      getBoardingUtxos: async () => [mature],
      unlockPhone: async () => phoneSecret,
      recover,
      onchainProvider: {} as OnchainProvider,
      locks: availableLocks,
    })
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce())
    await expect(
      recoverMatureBoardingInputs(enrollment, status, {
        getBoardingUtxos: async () => [mature],
        locks: availableLocks,
      }),
    ).rejects.toThrow(/already in progress/)
    finish('66'.repeat(32))
    await expect(first).resolves.toBe('66'.repeat(32))
  })

  it('refuses a second-tab recovery while the per-vault lock is held', async () => {
    const { enrollment, mature, status } = fixture()
    const recover = vi.fn()
    const heldLocks: VaultLockManager = {
      request: async (_name, _options, run) => run(null),
    }

    await expect(
      recoverMatureBoardingInputs(enrollment, status, {
        getBoardingUtxos: async () => [mature],
        recover,
        locks: heldLocks,
      }),
    ).rejects.toThrow(/already in progress/)
    expect(recover).not.toHaveBeenCalled()
  })
})

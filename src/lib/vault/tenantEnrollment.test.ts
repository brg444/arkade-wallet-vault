import 'fake-indexeddb/auto'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { createBoardingProgramScript, getNetwork } from '@arkade-os/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { vaultCosignerClient } from './cosignerClient'
import { loadEnrollment, loadStagedEnrollment, saveStagedEnrollment } from './enrollmentStore'
import { vaultStatusPath } from './status'
import { requireProposedProgramDescriptor } from './program/enroll'
import type { VaultStatus } from './types'
import { reconcileStagedEnrollment } from './tenantEnrollment'
import {
  activateBoardingKey,
  deleteBoardingKey,
  MUTINYNET_OPERATOR_SIGNER_PUB,
  stageBoardingKey,
  BOARDING_EXIT_DELAY,
  BOARDING_EXIT_DELAY_UNIT,
  BOARDING_PROGRAM,
  BOARDING_SCHEMA,
  BOARDING_TEMPLATE,
} from './vtxo/board'

const CRASH_VAULT_ID = 'vault-crash-window'

afterEach(async () => {
  localStorage.clear()
  vi.restoreAllMocks()
  await deleteBoardingKey(CRASH_VAULT_ID).catch(() => undefined)
})

describe('tenant enrollment identity', () => {
  it('requires an explicit vault id on the status path', () => {
    expect(() => vaultStatusPath('')).toThrow(/vault id required/)
  })

  it('rejects a descriptor outside the current program', () => {
    expect(() => requireProposedProgramDescriptor({ schema: 'retired' }, '00'.repeat(32))).toThrow(
      /current Vault Program descriptor/,
    )
  })

  it('reconciles a crash after board-key activation but before enrollment promotion', async () => {
    const phoneSecret = new Uint8Array(32)
    phoneSecret[31] = 7
    const phonePub = hex.encode(secp256k1.getPublicKey(phoneSecret, true))
    const stagedKey = await stageBoardingKey({
      vaultId: CRASH_VAULT_ID,
      phoneSecret,
      network: 'mutinynet',
    })
    phoneSecret.fill(0)
    const cosignerSecret = new Uint8Array(32)
    cosignerSecret[31] = 8
    const cosignerPub = hex.encode(secp256k1.getPublicKey(cosignerSecret, true))
    cosignerSecret.fill(0)
    const program = createBoardingProgramScript(
      {
        name: BOARDING_PROGRAM,
        boardingPubKey: hex.decode(stagedKey.boardingPub).slice(1),
        cosignerPubKey: hex.decode(cosignerPub).slice(1),
        recoveryPubKey: hex.decode(phonePub).slice(1),
      },
      hex.decode(MUTINYNET_OPERATOR_SIGNER_PUB).slice(1),
      { type: 'seconds', value: BigInt(BOARDING_EXIT_DELAY) },
    )
    const descriptorHash = 'ab'.repeat(32)
    const descriptor = {
      schema: BOARDING_SCHEMA,
      program: BOARDING_PROGRAM,
      template: BOARDING_TEMPLATE,
      network: 'mutinynet' as const,
      boardingPub: stagedKey.boardingPub,
      recoveryPhonePub: phonePub,
      vaultBoardCosignerPub: cosignerPub,
      operatorPub: MUTINYNET_OPERATOR_SIGNER_PUB,
      exitDelay: BOARDING_EXIT_DELAY,
      exitDelayUnit: BOARDING_EXIT_DELAY_UNIT,
      script: hex.encode(program.pkScript),
      address: program.onchainAddress(getNetwork('mutinynet')),
    }
    await activateBoardingKey({
      vaultId: CRASH_VAULT_ID,
      descriptorHash,
      expectedBoardingPub: stagedKey.boardingPub,
    })
    saveStagedEnrollment({
      vaultId: CRASH_VAULT_ID,
      credId: '01',
      webauthnP256: '02',
      phoneDirectP256: '03',
      phoneBip340Pub: phonePub,
      nonce: '04',
      ciphertext: '05',
      handle: 'handle',
      userHandle: 'user',
      clientDataJSON: '06',
      authenticatorData: '07',
      attestationObject: '08',
      hardwareXOnly: '09',
      descriptorHash,
      boardingPub: stagedKey.boardingPub,
      boardingDescriptor: descriptor,
      boardingDescriptorHash: descriptorHash,
    })
    const status: VaultStatus = {
      enrolled: true,
      network: 'mutinynet',
      clientOrigin: location.origin,
      rpId: location.hostname,
      vaultId: CRASH_VAULT_ID,
      templateVersion: 'phone-hww-recovery-staged-v6',
      policyVersion: 'vault-policy-v1',
      savingsAddress: 'tb1psavings',
      savingsScript: `5120${'11'.repeat(32)}`,
      periodAllowance: 100_000,
      periodSpent: 0,
      periodRemaining: 100_000,
      txCap: 50_000,
      absoluteFeeCap: 5_000,
      feerateCapSatVb: 10,
      phoneBip340Pub: phonePub,
      vtxoVaultCosignerPub: `02${'22'.repeat(32)}`,
      vtxoExitDelay: 4608,
      vtxoExitDelayUnit: 'seconds',
      spendingArkAddress: 'tark1spending',
      spendingArkScript: `5120${'33'.repeat(32)}`,
      vtxoDelegatePub: `02${'44'.repeat(32)}`,
      vtxoBoardingActive: true,
      vtxoBoardingProgram: BOARDING_PROGRAM,
      vtxoBoardingAddress: descriptor.address,
      vtxoBoardingScript: descriptor.script,
      vtxoBoardingExitDelay: BOARDING_EXIT_DELAY,
      vtxoBoardingExitDelayUnit: BOARDING_EXIT_DELAY_UNIT,
      vtxoBoardingDescriptor: descriptor,
      vtxoBoardingDescriptorHash: descriptorHash,
    }
    vi.spyOn(vaultCosignerClient.enrollment, 'status').mockResolvedValue(status)

    await expect(reconcileStagedEnrollment()).resolves.toMatchObject({ status })
    expect(loadStagedEnrollment()).toBeNull()
    expect(loadEnrollment(localStorage, CRASH_VAULT_ID)).toMatchObject({ vaultId: CRASH_VAULT_ID })
  })
})

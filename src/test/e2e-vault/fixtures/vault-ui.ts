import { ArkAddress, createBoardingProgramScript, getNetwork } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { POLICY_VERSION } from '../../../lib/vault/constants'
import { saveEnrollment, saveSelectedVaultId } from '../../../lib/vault/enrollmentStore'
import { pinFromEnrolledStatus, saveAddressPin } from '../../../lib/vault/pin'
import { buildVaultProgramDescriptor } from '../../../lib/vault/program/descriptor'
import { PROGRAM_FIXTURE, scalarSecret } from '../../../lib/vault/program/fixtures'
import { hashBoardingEnrollmentDescriptor } from '../../../lib/vault/program/enroll'
import { buildRecoveryKit } from '../../../lib/vault/program/kit'
import { saveLocalKit } from '../../../lib/vault/program/kitStore'
import { SAVINGS_TEMPLATE } from '../../../lib/vault/program/constants'
import { saveSetupPlan } from '../../../lib/vault/setupPlan'
import type { VaultStatus } from '../../../lib/vault/types'
import { spendingPolicyFromLimits, spendingPolicyDigest } from '../../../lib/vault/spendingPolicy'
import {
  activateBoardingKey,
  stageBoardingKey,
  BOARDING_EXIT_DELAY,
  BOARDING_EXIT_DELAY_UNIT,
  BOARDING_PROGRAM,
  BOARDING_SCHEMA,
  BOARDING_TEMPLATE,
  MUTINYNET_OPERATOR_SIGNER_PUB,
} from '../../../lib/vault/vtxo/board'
import {
  VAULT_POLICY_V1_EXIT_DELAY,
  VAULT_POLICY_V1_EXIT_DELAY_UNIT,
  VAULT_POLICY_V1_PINNED_DELEGATE,
  VaultPolicyV1Script,
} from '../../../lib/vault/vtxo/script'
import { persistVtxoSpend, type PersistedVtxoSpend } from '../../../lib/vault/vtxo/spend'

export const VAULT_UI_ID = 'e2e-vault-ui'
export const OPERATOR_XONLY = MUTINYNET_OPERATOR_SIGNER_PUB.slice(2)
export const VAULT_UI_DESTINATION = new ArkAddress(
  hex.decode(OPERATOR_XONLY),
  hex.decode('5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc'),
  'tark',
).encode()

function xonly(compressed: string): Uint8Array {
  return hex.decode(compressed).subarray(1)
}

export async function vaultUiStatus(origin = location.origin, hostname = location.hostname): Promise<VaultStatus> {
  const descriptor = buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, vaultId: VAULT_UI_ID })
  const delegatePub = VAULT_POLICY_V1_PINNED_DELEGATE
  const spending = new VaultPolicyV1Script({
    userPub: xonly(descriptor.keys.phoneBip340),
    vtxoVaultCosignerPub: xonly(descriptor.keys.vaultCosignerBase),
    arkdServerPub: hex.decode(OPERATOR_XONLY),
    delegatePub: xonly(delegatePub),
    exitDelay: VAULT_POLICY_V1_EXIT_DELAY,
    exitDelayUnit: VAULT_POLICY_V1_EXIT_DELAY_UNIT,
    exitDevicePub: xonly(descriptor.keys.phoneBip340),
    exitHardwarePub: xonly(descriptor.keys.hardware),
    exitRecoveryPub: xonly(descriptor.keys.recovery!),
  })
  const phoneSecret = scalarSecret(3)
  const staged = await stageBoardingKey({ vaultId: VAULT_UI_ID, phoneSecret, network: 'mutinynet' })
  phoneSecret.fill(0)
  const boarding = createBoardingProgramScript(
    {
      name: BOARDING_PROGRAM,
      boardingPubKey: xonly(staged.boardingPub),
      cosignerPubKey: xonly(descriptor.keys.vaultCosignerBase),
      recoveryPubKey: xonly(descriptor.keys.phoneBip340),
    },
    xonly(MUTINYNET_OPERATOR_SIGNER_PUB),
    { type: BOARDING_EXIT_DELAY_UNIT, value: BigInt(BOARDING_EXIT_DELAY) },
  )
  const boardingDescriptor = {
    schema: BOARDING_SCHEMA,
    program: BOARDING_PROGRAM,
    template: BOARDING_TEMPLATE,
    network: 'mutinynet' as const,
    boardingPub: staged.boardingPub,
    recoveryPhonePub: descriptor.keys.phoneBip340,
    vaultBoardCosignerPub: descriptor.keys.vaultCosignerBase,
    operatorPub: MUTINYNET_OPERATOR_SIGNER_PUB,
    exitDelay: BOARDING_EXIT_DELAY,
    exitDelayUnit: BOARDING_EXIT_DELAY_UNIT,
    script: hex.encode(boarding.pkScript),
    address: boarding.onchainAddress(getNetwork('mutinynet')),
  }
  const boardingDescriptorHash = hashBoardingEnrollmentDescriptor({
    schema: 'arkade-vault/enrollment-with-board-v1',
    vaultId: VAULT_UI_ID,
    savings: descriptor,
    boarding: boardingDescriptor,
  })
  await activateBoardingKey({
    vaultId: VAULT_UI_ID,
    descriptorHash: boardingDescriptorHash,
    expectedBoardingPub: staged.boardingPub,
  })
  const spendingPolicy = spendingPolicyFromLimits({
    txRecipientCapSats: descriptor.policy.recipientCapSats,
    periodAllowanceSats: descriptor.policy.periodAllowanceSats,
    absoluteFeeCapSats: descriptor.policy.absoluteFeeCapSats,
    feerateCapSatPerV: descriptor.policy.feerateCapSatVb,
  })
  return {
    enrolled: true,
    network: 'mutinynet',
    clientOrigin: origin,
    rpId: hostname,
    vaultId: VAULT_UI_ID,
    templateVersion: SAVINGS_TEMPLATE,
    policyVersion: POLICY_VERSION,
    protectionTier: descriptor.protectionTier,
    savingsAddress: descriptor.savings.address,
    savingsScript: descriptor.savings.script,
    periodAllowance: spendingPolicy.periodAllowanceSats,
    periodSpent: 0,
    periodRemaining: spendingPolicy.periodAllowanceSats,
    txCap: spendingPolicy.txRecipientCapSats,
    absoluteFeeCap: spendingPolicy.absoluteFeeCapSats,
    feerateCapSatVb: spendingPolicy.feerateCapSatPerV,
    spendingPolicy,
    spendingPolicyDigest: spendingPolicyDigest(spendingPolicy),
    phoneBip340Pub: descriptor.keys.phoneBip340,
    phoneDirectP256: descriptor.keys.phoneDirectP256,
    externalOwnerWalletPub: descriptor.keys.hardware,
    recoveryPub: descriptor.keys.recovery,
    recoveryKeyPub: descriptor.keys.recovery,
    vaultCosignerBasePub: descriptor.keys.vaultCosignerBase,
    arkadeCosignerBasePub: descriptor.keys.arkadeCosignerBase,
    arkadeCosignerOrigin: descriptor.arkadeCosigner.origin,
    arkadeCosignerVersion: descriptor.arkadeCosigner.version,
    vtxoVaultCosignerPub: descriptor.keys.vaultCosignerBase,
    vtxoExitDelay: Number(VAULT_POLICY_V1_EXIT_DELAY),
    vtxoExitDelayUnit: VAULT_POLICY_V1_EXIT_DELAY_UNIT,
    spendingArkAddress: new ArkAddress(hex.decode(OPERATOR_XONLY), spending.tweakedPublicKey, 'tark').encode(),
    spendingArkScript: hex.encode(spending.pkScript),
    vtxoDelegatePub: delegatePub,
    vtxoBoardingActive: true,
    vtxoBoardingProgram: BOARDING_PROGRAM,
    vtxoBoardingAddress: boardingDescriptor.address,
    vtxoBoardingScript: hex.encode(boarding.pkScript),
    vtxoBoardingExitDelay: Number(BOARDING_EXIT_DELAY),
    vtxoBoardingExitDelayUnit: BOARDING_EXIT_DELAY_UNIT,
    vtxoBoardingDescriptor: boardingDescriptor,
    vtxoBoardingDescriptorHash: boardingDescriptorHash,
  }
}

export async function installVaultUiSession() {
  const status = await vaultUiStatus()
  const descriptor = buildVaultProgramDescriptor({ ...PROGRAM_FIXTURE, vaultId: VAULT_UI_ID })
  saveSelectedVaultId(VAULT_UI_ID)
  saveEnrollment({
    vaultId: VAULT_UI_ID,
    credId: '11'.repeat(32),
    webauthnP256: descriptor.keys.phoneDirectP256,
    phoneDirectP256: descriptor.keys.phoneDirectP256,
    phoneBip340Pub: descriptor.keys.phoneBip340,
    nonce: '22'.repeat(12),
    ciphertext: '33'.repeat(48),
  })
  saveAddressPin(pinFromEnrolledStatus(status))
  saveSetupPlan({
    protectionTier: descriptor.protectionTier,
    hardwarePub: descriptor.keys.hardware,
    recoveryPub: descriptor.keys.recovery || '',
    txCapSats: status.txCap,
    dailyLimitSats: status.periodAllowance,
    absoluteFeeCapSats: status.absoluteFeeCap,
    feerateCapSatPerV: status.feerateCapSatVb,
    acceptedDesign: true,
    complete: true,
  })
  saveLocalKit(buildRecoveryKit(descriptor))
  localStorage.removeItem('arkade-vault-v2:session-lock')
  return status
}

export function wireVaultVtxo(
  status: VaultStatus,
  input: {
    amount: number
    txid: string
    vout?: number
    createdAt?: number
    isSpent?: boolean
    spentBy?: string
    arkTxid?: string
    commitmentTxids?: string[]
  },
) {
  return {
    outpoint: { txid: input.txid, vout: input.vout || 0 },
    createdAt: String(Math.floor((input.createdAt || Date.now()) / 1_000)),
    expiresAt: null,
    amount: String(input.amount),
    script: status.spendingArkScript,
    isPreconfirmed: false,
    isSwept: false,
    isUnrolled: false,
    isSpent: input.isSpent === true,
    ...(input.spentBy ? { spentBy: input.spentBy } : {}),
    ...(input.arkTxid ? { arkTxid: input.arkTxid } : {}),
    // A settled VTXO is a leaf of a Batch Output. The SDK activity builder
    // keys that receive by its commitment transaction, so every settled test
    // fixture must carry the same graph fact the real indexer supplies.
    commitmentTxids: input.commitmentTxids || [input.txid],
  }
}

export function seedReviewedVtxoSpend(
  status: VaultStatus,
  destAddress: string,
  amountSats: number,
  feeSats: number,
  changeSats: number,
) {
  const record: PersistedVtxoSpend = {
    vaultId: status.vaultId,
    operationId: '44'.repeat(16),
    bundleDigest: '55'.repeat(32),
    destAddress,
    amountSats,
    arkTxid: '66'.repeat(32),
    reservationExpires: '2099-08-20T00:02:00Z',
    stage: 'reserved',
    feePolicyDigest: '77'.repeat(32),
    feeSats,
    changeSats,
    ...(changeSats > 0 ? { changeVout: 1 } : {}),
  }
  persistVtxoSpend(record)
  return record
}

export async function seedVaultLightningActivity(
  status: VaultStatus,
  input: {
    invoice: string
    rfqId: string
    fundingTxid: string
    state: 'failed' | 'needs_counterparty' | 'refunded'
    createdAt?: number
    invoiceAmountSats?: number
    corridorFeeSats?: number
    fundingFeeSats?: number
  },
) {
  const { withVaultWalletState } = await import('../../../lib/vault/vtxo/walletWorker')
  const invoiceAmountSats = input.invoiceAmountSats ?? 2_100
  const corridorFeeSats = input.corridorFeeSats ?? 25
  const fundingFeeSats = input.fundingFeeSats ?? 50
  const amountSats = invoiceAmountSats + corridorFeeSats
  const lockupAddress = String(status.spendingArkAddress || '')
  if (!lockupAddress) throw new Error('Lightning fixture requires a Spending address')
  await withVaultWalletState(status, ({ swapRepository }) =>
    swapRepository.saveRfqSwap({
      kind: 'lightning_send',
      rfqId: input.rfqId,
      lockupAddress,
      amount: amountSats,
      fundingArkTxid: input.fundingTxid,
      state: input.state,
      createdAt: input.createdAt ?? Math.floor(Date.now() / 1_000),
      updatedAt: input.createdAt ?? Math.floor(Date.now() / 1_000),
      ...(input.state === 'failed' ? { failure: 'fixture terminal failure' } : {}),
      ...(input.state === 'needs_counterparty' ? { blockedReason: 'fixture refund requires device unlock' } : {}),
      profile: {
        vaultLightning: {
          version: 2,
          network: 'mutinynet',
          invoice: input.invoice,
          fundingState: 'funding',
          fundingProof: {
            rfqId: input.rfqId,
            address: lockupAddress,
            amountSats,
            operationId: '44'.repeat(16),
            bundleDigest: '55'.repeat(32),
            fundingFeeSats,
          },
          quote: {
            v: 1,
            type: 'rfq_quote',
            rfq_id: input.rfqId,
            pair: 'arkade:BTC->lightning:BTC',
            amount_side: 'to',
            from_amount: amountSats,
            to_amount: invoiceAmountSats,
            solver_pubkey: '66'.repeat(32),
            valid_until: 4_000_000_000,
            refund_locktime: 4_000_000_100,
            profile: {},
          },
        },
      },
    }),
  )
  return { amountSats, feeSats: corridorFeeSats + fundingFeeSats }
}

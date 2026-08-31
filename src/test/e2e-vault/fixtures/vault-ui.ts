import { ArkAddress, DefaultVtxo } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { POLICY_VERSION } from '../../../lib/vault/constants'
import { saveEnrollment, saveSelectedVaultId } from '../../../lib/vault/enrollmentStore'
import { pinFromEnrolledStatus, saveAddressPin } from '../../../lib/vault/pin'
import { buildVaultProgramDescriptor } from '../../../lib/vault/program/descriptor'
import { PROGRAM_FIXTURE } from '../../../lib/vault/program/fixtures'
import { buildRecoveryKit } from '../../../lib/vault/program/kit'
import { saveLocalKit } from '../../../lib/vault/program/kitStore'
import { SAVINGS_TEMPLATE } from '../../../lib/vault/program/constants'
import { saveSetupPlan } from '../../../lib/vault/setupPlan'
import type { VaultStatus } from '../../../lib/vault/types'
import { vaultAddressNetwork } from '../../../lib/vault/bitcoin'
import {
  VAULT_BOARD_V1,
  VAULT_BOARD_V1_EXIT_DELAY,
  VAULT_BOARD_V1_EXIT_DELAY_UNIT,
} from '../../../lib/vault/vtxo/board'
import {
  VAULT_POLICY_V1_EXIT_DELAY,
  VAULT_POLICY_V1_EXIT_DELAY_UNIT,
  VAULT_POLICY_V1_PINNED_DELEGATE,
  VaultPolicyV1Script,
} from '../../../lib/vault/vtxo/script'
import { persistVtxoSpend, type PersistedVtxoSpend } from '../../../lib/vault/vtxo/spend'

export const VAULT_UI_ID = 'e2e-vault-ui'
export const OPERATOR_XONLY = 'e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13'
export const VAULT_UI_DESTINATION = new ArkAddress(
  hex.decode(OPERATOR_XONLY),
  hex.decode('5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc'),
  'tark',
).encode()

function xonly(compressed: string): Uint8Array {
  return hex.decode(compressed).subarray(1)
}

export function vaultUiStatus(origin = location.origin, hostname = location.hostname): VaultStatus {
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
  const boarding = new DefaultVtxo.Script({
    pubKey: xonly(descriptor.keys.phoneBip340),
    serverPubKey: hex.decode(OPERATOR_XONLY),
    csvTimelock: { type: VAULT_BOARD_V1_EXIT_DELAY_UNIT, value: VAULT_BOARD_V1_EXIT_DELAY },
  })
  return {
    enrolled: true,
    network: 'mutinynet',
    clientOrigin: origin,
    rpId: hostname,
    vaultId: VAULT_UI_ID,
    templateVersion: SAVINGS_TEMPLATE,
    policyVersion: POLICY_VERSION,
    savingsAddress: descriptor.savings.address,
    savingsScript: descriptor.savings.script,
    periodAllowance: 100_000,
    periodSpent: 0,
    periodRemaining: 100_000,
    txCap: 50_000,
    absoluteFeeCap: 1_500,
    feerateCapSatVb: 10,
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
    vtxoBoardingProgram: VAULT_BOARD_V1,
    vtxoBoardingAddress: boarding.onchainAddress(vaultAddressNetwork('mutinynet')),
    vtxoBoardingScript: hex.encode(boarding.pkScript),
    vtxoBoardingExitDelay: Number(VAULT_BOARD_V1_EXIT_DELAY),
    vtxoBoardingExitDelayUnit: VAULT_BOARD_V1_EXIT_DELAY_UNIT,
  }
}

export function installVaultUiSession() {
  const status = vaultUiStatus()
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
    hardwarePub: descriptor.keys.hardware,
    recoveryPub: descriptor.keys.recovery || '',
    txCapSats: status.txCap,
    dailyLimitSats: status.periodAllowance,
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

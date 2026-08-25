import { vaultGet, vaultPost } from './api'
import { fetchPublicStatus, fetchVaultStatus, type PublicAuthorizerStatus } from './status'
import type { VaultStatus } from './types'

const enrollmentHeader = (token: string) => ({ 'X-Vault-Enrollment-Token': token })

export interface VaultInviteView {
  canEnroll: boolean
  vaultId: string | null
}

export interface VaultEnrollStartResponse {
  handle: string
  vaultId: string
  challenge: string
  rpId: string
  rpName: string
  userId: string
  userName: string
  timeoutMs: number
}

export interface VaultEnrollmentRequest {
  handle: string
  userHandle: string
  clientDataJSON: string
  authenticatorData: string
  attestationObject: string
  credentialId: string
  webauthnP256: string
  phoneDirectP256: string
  phoneBip340Pub: string
  vaultId: string
  externalOwnerWalletXOnly: string
  recoveryXOnly?: string
  descriptorHash?: string
}

export interface VaultEnrollProposeResponse {
  vaultId: string
  descriptorHash: string
  descriptor: unknown
}

export type VaultPasskeyPurpose = 'recover' | 'install-envelope' | 'transition' | 'map-write'

export interface VaultPasskeyChallengeRequest {
  purpose: VaultPasskeyPurpose
  vaultId: string
}

export interface VaultPasskeyChallengeResponse {
  challengeId: string
  challenge: string
  allowCredentialId?: string
  expiresInSeconds?: number
}

export interface VaultSessionAssertion {
  challengeId: string
  credentialId: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  directProof: string
}

export interface VaultRecoveryBindingRequest {
  vaultId: string
  envelopeNonce: string
  envelopeCiphertext: string
}

export interface VaultRecoveryBindingResponse {
  binding: string
  bindingDigest: string
}

export interface VaultInstallEnvelopeRequest extends VaultRecoveryBindingRequest, VaultSessionAssertion {
  binding: string
  bindingDirectSig: string
  bindingPhoneSig: string
}

export interface VaultRecoverEnvelopeRequest extends VaultSessionAssertion {
  vaultId: string
}

export interface VaultRecoverEnvelopeResponse extends VaultRecoveryBindingResponse {
  envelopeNonce: string
  envelopeCiphertext: string
  bindingDirectSig: string
  bindingPhoneSig: string
}

export type VaultTransitionRequest = {
  vaultId: string
  psbt: string
} & Partial<VaultSessionAssertion>

export interface VaultTransitionResponse {
  signedPsbt: string
  replay: boolean
}

export interface VaultMapWriteRequest extends VaultSessionAssertion {
  vaultId: string
  payload: unknown
}

export interface VtxoReserveRequest {
  operationId: string
  vaultId: string
  purpose: 'spend'
  destAddress: string
  amountSats: number
  phoneSignature: string
}

export interface VtxoReserveResponse {
  operationId: string
  bundleDigest: string
  reservationExpires: string
  inputs: { txid: string; vout: number; valueSats: number; scriptHex: string }[]
  changeAddress: string
  changeScript: string
  changeSats: number
  changeVout?: number
  destScript: string
  feeSats: number
  feePolicyDigest: string
  checkpointTapscript: string
}

export interface VtxoAuthorizeRequest {
  vaultId: string
  operationId: string
  bundleDigest: string
  unsignedArkPsbt: string
  unsignedCheckpointPsbts: string[]
  pendingProof: string
  credentialId: string
  clientDataJSON: string
  authenticatorData: string
  signature: string
  directSig: string
}

export interface VtxoAuthorizeResponse {
  operationId: string
  bundleDigest: string
  authorizedPsbt: string
  authorizedPendingProof: string
  arkTxid: string
}

export interface VtxoCheckpointAuthorizeRequest {
  vaultId: string
  operationId: string
  bundleDigest: string
  checkpointPsbts: string[]
}

export interface VtxoCheckpointAuthorizeResponse {
  operationId: string
  bundleDigest: string
  checkpointPsbts: string[]
  arkTxid: string
}

export interface VtxoFinalizeRequest {
  vaultId: string
  operationId: string
  bundleDigest: string
  arkTxid: string
}

export interface VtxoFinalizeResponse {
  operationId: string
  bundleDigest: string
  state: string
  arkTxid: string
}

export type VtxoOperationState = 'reserved' | 'signed' | 'submitted' | 'finalized' | 'aborted' | 'unresolved'

export interface VtxoOperationView {
  operationId: string
  bundleDigest: string
  state: VtxoOperationState
  arkTxid?: string
  expiresAt?: string
  feeSats?: number
  feePolicyDigest?: string
  changeSats?: number
  changeVout?: number
  authorizedPsbt?: string
  authorizedPendingProof?: string
  checkpointPsbts?: string[]
}

export interface VaultCosignerEnrollmentClient {
  publicStatus(signal?: AbortSignal): Promise<PublicAuthorizerStatus>
  status(vaultId: string, signal?: AbortSignal): Promise<VaultStatus>
  invite(token: string): Promise<VaultInviteView>
  start(token: string): Promise<VaultEnrollStartResponse>
  propose(token: string, request: VaultEnrollmentRequest): Promise<VaultEnrollProposeResponse>
  finish(token: string, request: VaultEnrollmentRequest): Promise<VaultStatus>
  binding(request: VaultRecoveryBindingRequest): Promise<VaultRecoveryBindingResponse>
  install(request: VaultInstallEnvelopeRequest): Promise<{ ok: boolean }>
  recover(request: VaultRecoverEnvelopeRequest): Promise<VaultRecoverEnvelopeResponse>
}

export interface VaultCosignerRecoveryClient {
  challenge(request: VaultPasskeyChallengeRequest): Promise<VaultPasskeyChallengeResponse>
  initiate(request: VaultTransitionRequest): Promise<VaultTransitionResponse>
  clawback(request: VaultTransitionRequest): Promise<VaultTransitionResponse>
  readMap(vaultId: string): Promise<unknown>
  writeMap(request: VaultMapWriteRequest): Promise<{ ok: boolean }>
}

export interface VaultCosignerSpendingClient {
  reserve(request: VtxoReserveRequest): Promise<VtxoReserveResponse>
  authorize(request: VtxoAuthorizeRequest): Promise<VtxoAuthorizeResponse>
  authorizeCheckpoints(request: VtxoCheckpointAuthorizeRequest): Promise<VtxoCheckpointAuthorizeResponse>
  finalize(request: VtxoFinalizeRequest): Promise<VtxoFinalizeResponse>
  operation(vaultId: string, operationId: string): Promise<VtxoOperationView>
}

export interface VaultCosignerClient {
  enrollment: VaultCosignerEnrollmentClient
  recovery: VaultCosignerRecoveryClient
  spending: VaultCosignerSpendingClient
}

export const vaultCosignerClient: VaultCosignerClient = {
  enrollment: {
    publicStatus(signal) {
      return fetchPublicStatus(signal)
    },
    status(vaultId, signal) {
      return fetchVaultStatus(signal, vaultId)
    },
    invite(token) {
      return vaultGet('/v1/invite', enrollmentHeader(token))
    },
    start(token) {
      return vaultPost('/v1/enroll/start', {}, enrollmentHeader(token))
    },
    propose(token, request) {
      return vaultPost('/v1/enroll/propose', request, enrollmentHeader(token))
    },
    finish(token, request) {
      return vaultPost('/v1/enroll/finish', request, enrollmentHeader(token))
    },
    binding(request) {
      return vaultPost('/v1/passkey/binding', request)
    },
    install(request) {
      return vaultPost('/v1/passkey/install', request)
    },
    recover(request) {
      return vaultPost('/v1/passkey/recover', request)
    },
  },
  recovery: {
    challenge(request) {
      return vaultPost('/v1/passkey/challenge', request)
    },
    initiate(request) {
      return vaultPost('/v1/initiate', request)
    },
    clawback(request) {
      return vaultPost('/v1/clawback', request)
    },
    readMap(vaultId) {
      return vaultGet(`/v1/map?vault=${encodeURIComponent(vaultId)}`)
    },
    writeMap(request) {
      return vaultPost('/v1/map', request)
    },
  },
  spending: {
    reserve(request) {
      return vaultPost('/v1/vtxo/reserve', request)
    },
    authorize(request) {
      return vaultPost('/v1/vtxo/authorize', request)
    },
    authorizeCheckpoints(request) {
      return vaultPost('/v1/vtxo/checkpoints/authorize', request)
    },
    finalize(request) {
      return vaultPost('/v1/vtxo/finalize', request)
    },
    operation(vaultId, operationId) {
      return vaultGet(
        `/v1/vtxo/operation?vaultId=${encodeURIComponent(vaultId)}&operationId=${encodeURIComponent(operationId)}`,
      )
    },
  },
}

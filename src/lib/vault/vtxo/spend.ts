import {
  ArkAddress,
  buildOffchainTx,
  CSVMultisigTapscript,
  Intent,
  RestArkProvider,
  RestIndexerProvider,
  SingleKey,
  Transaction,
  type ArkProvider,
  verifyTapscriptSignatures,
} from '@arkade-os/sdk'
import { SigHash } from '@scure/btc-signer'
import { base64, hex } from '@scure/base'
import { vaultGet, vaultPost } from '../api'
import { deriveDirectP256, signDirectP256, zeroBytes } from '../ceremony/directauth'
import { historyFromVtxos, type VaultHistoryItem } from '../history'
import { unlockPhoneBip340 } from '../savingsSpend'
import type { EnrollmentSecrets } from '../tenantEnrollment'
import type { VaultStatus } from '../types'
import { deviceSigningOptions, prfExtension, prfFrom } from '../webauthn'
import { arkadeIntentFeePolicyDigest } from './feePolicy'
import { browserVaultLockManager, requireVaultLockManager, type VaultLockManager } from './lock'
import { signVtxoReserveDigest, verifyVtxoReserveSignature, type VtxoReserveDigestInput } from './reserveAuth'
import {
  VAULT_POLICY_V1_EXIT_DELAY,
  VAULT_POLICY_V1_EXIT_DELAY_UNIT,
  VaultPolicyV1Script,
  type VaultPolicyV1Params,
} from './script'

const PRF_SALT = new TextEncoder().encode('arkade-2fa-vault/prf/v1')
const HKDF_INFO = new TextEncoder().encode('arkade-2fa-vault/kek/v1')
const MUTINYNET_OPERATOR_ORIGIN = 'https://mutinynet.arkade.sh'
const VTXO_DUST_SATS = 330
const MAX_VTXO_INPUTS = 50

export function vaultArkServer(production = import.meta.env.PROD): string {
  return production ? '/arkade' : MUTINYNET_OPERATOR_ORIGIN
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

interface VtxoAuthorizeResponse {
  operationId: string
  bundleDigest: string
  authorizedPsbt: string
  authorizedPendingProof: string
  arkTxid: string
}

interface VtxoCheckpointAuthorizeResponse {
  operationId: string
  bundleDigest: string
  checkpointPsbts: string[]
  arkTxid: string
}

interface VtxoFinalizeResponse {
  operationId: string
  bundleDigest: string
  state: string
  arkTxid: string
}

export interface VaultVtxoSpendResult {
  txid: string
  operationId: string
  feeSats: number
}

export interface VaultVtxoSpendQuote {
  operationId: string
  feeSats: number
  feePolicyDigest: string
  changeSats: number
  changeVout?: number
}

export class VtxoReceiptPendingError extends Error {
  readonly txid: string
  readonly operationId: string
  readonly feeSats: number

  constructor(txid: string, operationId: string, feeSats: number) {
    super('VTXO finalization receipt unavailable')
    this.name = 'VtxoReceiptPendingError'
    this.txid = txid
    this.operationId = operationId
    this.feeSats = feeSats
  }
}

export class VtxoSpendInFlightError extends Error {
  readonly txid: string
  readonly operationId: string

  constructor(txid: string, operationId: string) {
    super('VTXO spend is still with the operator')
    this.name = 'VtxoSpendInFlightError'
    this.txid = txid
    this.operationId = operationId
  }
}

export class VtxoSpendUnresolvedError extends Error {
  readonly txid: string
  readonly operationId: string

  constructor(txid: string, operationId: string) {
    super('VTXO spend is unresolved')
    this.name = 'VtxoSpendUnresolvedError'
    this.txid = txid
    this.operationId = operationId
  }
}

export function isVtxoReceiptPendingError(err: unknown): err is VtxoReceiptPendingError {
  return err instanceof VtxoReceiptPendingError
}

export function isVtxoSpendInFlightError(err: unknown): err is VtxoSpendInFlightError {
  return err instanceof VtxoSpendInFlightError
}

export function isVtxoSpendUnresolvedError(err: unknown): err is VtxoSpendUnresolvedError {
  return err instanceof VtxoSpendUnresolvedError
}

export type PersistedVtxoSpendStage =
  | 'pre-reserve'
  | 'reserved'
  | 'authorized'
  | 'operator-submitted'
  | 'checkpoints-authorized'
  | 'operator-finalized'

export type VtxoOperationState = 'reserved' | 'signed' | 'submitted' | 'finalized' | 'aborted' | 'unresolved'

export interface VtxoOperationView {
  operationId: string
  bundleDigest: string
  state: VtxoOperationState
  arkTxid?: string
  expiresAt?: string
  authorizedPsbt?: string
  authorizedPendingProof?: string
  checkpointPsbts?: string[]
}

export interface PersistedVtxoSpend {
  vaultId: string
  operationId: string
  bundleDigest: string
  destAddress: string
  amountSats: number
  arkTxid: string
  reservationExpires?: string
  checkpointTapscript?: string
  stage: PersistedVtxoSpendStage
  unsignedArkPsbt?: string
  authorizedPsbt?: string
  authorizedPendingProof?: string
  operatorSubmitAttempted?: boolean
  unsignedCheckpointPsbts?: string[]
  operatorCheckpointPsbts?: string[]
  checkpointPsbts?: string[]
  reservePhoneSignature?: string
  feePolicyDigest?: string
  feeSats?: number
  changeSats?: number
  changeVout?: number
}

export function vtxoSpendStorageKey(vaultId: string): string {
  return `arkade-vault-vtxo-spend:${vaultId}`
}

function persistedReservationFactsAreValid(record: Partial<PersistedVtxoSpend>): boolean {
  if (record.stage === 'pre-reserve') return true
  return Boolean(
    /^[0-9a-f]{64}$/.test(String(record.feePolicyDigest || '')) &&
      typeof record.feeSats === 'number' &&
      Number.isSafeInteger(record.feeSats) &&
      record.feeSats >= 0 &&
      typeof record.changeSats === 'number' &&
      Number.isSafeInteger(record.changeSats) &&
      record.changeSats >= 0 &&
      (record.changeSats === 0 ? record.changeVout === undefined : record.changeVout === 1),
  )
}

export function loadPersistedVtxoSpend(vaultId: string): PersistedVtxoSpend | undefined {
  if (typeof localStorage === 'undefined' || !vaultId) return undefined
  try {
    const parsed = JSON.parse(
      localStorage.getItem(vtxoSpendStorageKey(vaultId)) || 'null',
    ) as Partial<PersistedVtxoSpend>
    if (
      parsed &&
      parsed.vaultId === vaultId &&
      isVtxoOperationId(parsed.operationId) &&
      parsed.stage &&
      parsed.destAddress &&
      typeof parsed.amountSats === 'number' &&
      (parsed.reservePhoneSignature === undefined || /^[0-9a-f]{128}$/.test(parsed.reservePhoneSignature)) &&
      persistedReservationFactsAreValid(parsed) &&
      (parsed.stage === 'pre-reserve' || (parsed.bundleDigest && (parsed.stage === 'reserved' || parsed.arkTxid)))
    ) {
      return parsed as PersistedVtxoSpend
    }
  } catch {
    return undefined
  }
  return undefined
}

export function isVtxoOperationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)
}

export function createVtxoOperationId(random?: Uint8Array): string {
  const bytes = random || crypto.getRandomValues(new Uint8Array(16))
  if (bytes.length !== 16) throw new Error('VTXO operation id requires 16 random bytes')
  return hex.encode(bytes)
}

export function preReserveVtxoSpend(
  vaultId: string,
  destAddress: string,
  amountSats: number,
  operationId = createVtxoOperationId(),
): PersistedVtxoSpend {
  if (!vaultId.trim()) throw new Error('vault id required')
  if (!isVtxoOperationId(operationId)) throw new Error('invalid VTXO operation id')
  const record: PersistedVtxoSpend = {
    vaultId,
    operationId,
    bundleDigest: '',
    destAddress: destAddress.trim(),
    amountSats,
    arkTxid: '',
    stage: 'pre-reserve',
  }
  persistVtxoSpend(record)
  return record
}

export function vtxoReserveRequest(pending: PersistedVtxoSpend, status: VaultStatus) {
  if (pending.stage !== 'pre-reserve' || !isVtxoOperationId(pending.operationId)) {
    throw new Error('VTXO pre-reservation required')
  }
  if (!pending.reservePhoneSignature || !reserveSignatureMatches(pending, status)) {
    throw new Error('VTXO reservation requires this device signature')
  }
  return {
    vaultId: pending.vaultId,
    operationId: pending.operationId,
    purpose: 'spend',
    destAddress: pending.destAddress,
    amountSats: pending.amountSats,
    phoneSignature: pending.reservePhoneSignature,
  }
}

export function persistVtxoSpend(record: PersistedVtxoSpend) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(vtxoSpendStorageKey(record.vaultId), JSON.stringify(record))
}

export function clearPersistedVtxoSpend(vaultId: string) {
  if (typeof localStorage === 'undefined' || !vaultId) return
  localStorage.removeItem(vtxoSpendStorageKey(vaultId))
}

function requireHex(value: string | undefined, bytes: number, name: string): Uint8Array {
  let decoded: Uint8Array
  try {
    decoded = hex.decode(String(value || '').toLowerCase())
  } catch {
    throw new Error(`${name} is not hex`)
  }
  if (decoded.length !== bytes) throw new Error(`${name} must be ${bytes} bytes`)
  return decoded
}

function xOnly(value: string | undefined, name: string): Uint8Array {
  const raw = String(value || '').toLowerCase()
  if (/^(02|03)[0-9a-f]{64}$/.test(raw)) return hex.decode(raw.slice(2))
  return requireHex(raw, 32, name)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function requireMutinynetStatus(status: VaultStatus) {
  if (!status.enrolled || status.network !== 'mutinynet') throw new Error('regular VTXO spending is Mutinynet-only')
  if (!status.vaultId) throw new Error('vault id required')
  if (status.vtxoExitDelay !== Number(VAULT_POLICY_V1_EXIT_DELAY)) throw new Error('VTXO exit delay does not match')
  if (status.vtxoExitDelayUnit !== VAULT_POLICY_V1_EXIT_DELAY_UNIT)
    throw new Error('VTXO exit delay unit does not match')
}

export function vaultPolicyV1ScriptFromStatus(status: VaultStatus): VaultPolicyV1Script {
  requireMutinynetStatus(status)
  const address = ArkAddress.decode(String(status.spendingArkAddress || ''))
  if (address.hrp !== 'tark') throw new Error('spending Ark address is not a test-network address')
  const params: VaultPolicyV1Params = {
    userPub: xOnly(status.phoneBip340Pub, 'phone pubkey'),
    vtxoVaultCosignerPub: xOnly(status.vtxoVaultCosignerPub, 'VTXO VaultCosigner pubkey'),
    arkdServerPub: address.serverPubKey,
    delegatePub: xOnly(status.vtxoDelegatePub, 'delegate pubkey'),
    exitDelay: VAULT_POLICY_V1_EXIT_DELAY,
    exitDelayUnit: VAULT_POLICY_V1_EXIT_DELAY_UNIT,
    exitDevicePub: xOnly(status.phoneBip340Pub, 'phone pubkey'),
    exitHardwarePub: xOnly(status.externalOwnerWalletPub, 'hardware pubkey'),
    ...(status.recoveryKeyPub || status.recoveryPub
      ? { exitRecoveryPub: xOnly(status.recoveryKeyPub || status.recoveryPub, 'recovery pubkey') }
      : {}),
  }
  const script = new VaultPolicyV1Script(params)
  const advertised = requireHex(status.spendingArkScript, 34, 'spending Ark script')
  if (!sameBytes(script.pkScript, advertised) || !sameBytes(address.pkScript, advertised)) {
    throw new Error('spending Ark address does not match vault-policy-v1')
  }
  return script
}

async function requirePinnedOperator(provider: ArkProvider, status: VaultStatus, checkpointTapscript?: string) {
  const info = await provider.getInfo()
  if (info.network !== 'mutinynet') throw new Error('Operator network is not Mutinynet')
  const address = ArkAddress.decode(String(status.spendingArkAddress || ''))
  if (!sameBytes(xOnly(info.signerPubkey, 'Operator signer pubkey'), address.serverPubKey)) {
    throw new Error('Operator signer does not match the spending address')
  }
  if (checkpointTapscript && info.checkpointTapscript.toLowerCase() !== checkpointTapscript.toLowerCase()) {
    throw new Error('Operator checkpoint tapscript changed after reservation')
  }
  return info
}

async function requireCurrentReservationPolicy(
  provider: ArkProvider,
  status: VaultStatus,
  pending: PersistedVtxoSpend,
) {
  const info = await requirePinnedOperator(provider, status, pending.checkpointTapscript)
  const currentFeePolicyDigest = arkadeIntentFeePolicyDigest(info.fees.intentFee)
  if (!pending.feePolicyDigest || currentFeePolicyDigest !== pending.feePolicyDigest) {
    throw new Error('Operator fee policy changed after reservation')
  }
  return info
}

async function authorizeWithPasskey(
  enrollment: EnrollmentSecrets,
  status: VaultStatus,
  digestHex: string,
): Promise<{ assertion: Record<string, string>; directSig: string; phoneSecret: Uint8Array }> {
  const digest = requireHex(digestHex, 32, 'bundle digest')
  const rpId = String(status.rpId || '').toLowerCase()
  if (!rpId || rpId !== location.hostname.toLowerCase()) {
    throw new Error('deployment RP ID does not match this signing client host')
  }
  if (status.clientOrigin !== location.origin) {
    throw new Error('deployment origin does not match this signing client origin')
  }
  const credentialId = requireHex(enrollment.credId, enrollment.credId.length / 2, 'credential id')
  const credential = (await navigator.credentials.get({
    publicKey: deviceSigningOptions(
      {
        challenge: digest,
        rpId,
        userVerification: 'required',
        extensions: prfExtension(PRF_SALT, credentialId),
      },
      credentialId,
    ),
  })) as PublicKeyCredential | null
  if (!credential) throw new Error('The operation was aborted.')
  const prf = prfFrom(credential)
  if (!prf || prf.length !== 32) throw new Error('authenticator did not return PRF')
  let scalar: Uint8Array | undefined
  try {
    const derived = await deriveDirectP256(prf)
    scalar = derived.scalar
    if (hex.encode(derived.pub) !== enrollment.phoneDirectP256 || hex.encode(derived.pub) !== status.phoneDirectP256) {
      throw new Error('passkey direct key does not match this vault')
    }
    const kek = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO },
      await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    )
    const phoneSecret = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: requireHex(enrollment.nonce, 12, 'enrollment nonce') },
        kek,
        hex.decode(enrollment.ciphertext),
      ),
    )
    const identity = SingleKey.fromPrivateKey(phoneSecret)
    if (hex.encode(await identity.compressedPublicKey()) !== enrollment.phoneBip340Pub) {
      zeroBytes(phoneSecret)
      throw new Error('phone key does not match this vault')
    }
    const response = credential.response as AuthenticatorAssertionResponse
    return {
      assertion: {
        credentialId: enrollment.credId,
        clientDataJSON: hex.encode(new Uint8Array(response.clientDataJSON)),
        authenticatorData: hex.encode(new Uint8Array(response.authenticatorData)),
        signature: hex.encode(new Uint8Array(response.signature)),
      },
      directSig: hex.encode(signDirectP256(scalar, digest)),
      phoneSecret,
    }
  } finally {
    zeroBytes(prf, scalar)
  }
}

export function vtxoDestinationScript(status: VaultStatus, destAddress: string): Uint8Array {
  const spendingAddress = ArkAddress.decode(String(status.spendingArkAddress || ''))
  let destination: ArkAddress
  try {
    destination = ArkAddress.decode(destAddress.trim())
  } catch {
    throw new Error('regular VTXO destination must be an Arkade address')
  }
  if (destination.hrp !== 'tark') throw new Error('destination is not a test-network Arkade address')
  if (!sameBytes(destination.serverPubKey, spendingAddress.serverPubKey)) {
    throw new Error('destination belongs to another Arkade Operator')
  }
  return destination.pkScript
}

function reserveDigestInput(pending: PersistedVtxoSpend, status: VaultStatus): VtxoReserveDigestInput {
  if (pending.vaultId !== status.vaultId) throw new Error('VTXO reservation vault does not match status')
  return {
    operationId: pending.operationId,
    vaultId: pending.vaultId,
    destScript: vtxoDestinationScript(status, pending.destAddress),
    amountSats: pending.amountSats,
  }
}

function reserveSignatureMatches(pending: PersistedVtxoSpend, status: VaultStatus): boolean {
  if (!pending.reservePhoneSignature) return false
  return verifyVtxoReserveSignature(
    reserveDigestInput(pending, status),
    pending.reservePhoneSignature,
    xOnly(status.phoneBip340Pub, 'phone pubkey'),
  )
}

/** Persist the signature before the reservation request can leave this process. */
export function persistVtxoReserveSignature(
  pending: PersistedVtxoSpend,
  status: VaultStatus,
  phoneSecret: Uint8Array,
  auxRand?: Uint8Array,
): PersistedVtxoSpend {
  if (pending.stage !== 'pre-reserve') throw new Error('VTXO pre-reservation required')
  if (pending.reservePhoneSignature) {
    if (!reserveSignatureMatches(pending, status)) throw new Error('persisted VTXO reserve signature is invalid')
    return pending
  }
  const expectedPhone = xOnly(status.phoneBip340Pub, 'phone pubkey')
  const signature = hex.encode(signVtxoReserveDigest(reserveDigestInput(pending, status), phoneSecret, auxRand))
  if (!verifyVtxoReserveSignature(reserveDigestInput(pending, status), signature, expectedPhone)) {
    throw new Error('phone key does not match this vault')
  }
  const next = { ...pending, reservePhoneSignature: signature }
  persistVtxoSpend(next)
  return next
}

export function buildReservedVtxoSpend(
  status: VaultStatus,
  reserve: VtxoReserveResponse,
  amountSats: number,
  destAddress: string,
  expectedFeePolicyDigest: string,
) {
  const script = vaultPolicyV1ScriptFromStatus(status)
  if (!Number.isSafeInteger(amountSats) || amountSats < VTXO_DUST_SATS) {
    throw new Error('VTXO amount is below dust')
  }
  if (amountSats > status.txCap) throw new Error('VTXO amount exceeds the transaction cap')
  if (!/^[0-9a-f]{64}$/.test(reserve.feePolicyDigest)) throw new Error('fee policy digest is malformed')
  if (reserve.feePolicyDigest !== expectedFeePolicyDigest) throw new Error('Operator fee policy changed')
  if (!Number.isSafeInteger(reserve.feeSats) || reserve.feeSats < 0) throw new Error('reserved fee is invalid')
  if (reserve.feeSats > status.absoluteFeeCap) throw new Error('reserved fee exceeds the vault cap')
  if (amountSats + reserve.feeSats > status.periodRemaining) throw new Error('reserved total exceeds the allowance')
  if (!Number.isSafeInteger(reserve.changeSats) || reserve.changeSats < 0) {
    throw new Error('reserved change is invalid')
  }
  if (reserve.inputs.length < 1 || reserve.inputs.length > MAX_VTXO_INPUTS) {
    throw new Error(`reservation must contain 1 to ${MAX_VTXO_INPUTS} inputs`)
  }

  const policyScriptHex = hex.encode(script.pkScript)
  let previousOutpoint = ''
  let inputTotal = 0n
  for (const input of reserve.inputs) {
    if (!/^[0-9a-f]{64}$/.test(input.txid)) throw new Error('reserved input txid is malformed')
    if (!Number.isSafeInteger(input.vout) || input.vout < 0 || input.vout > 0xffffffff) {
      throw new Error('reserved input vout is malformed')
    }
    if (!Number.isSafeInteger(input.valueSats) || input.valueSats <= 0) {
      throw new Error('reserved input value is malformed')
    }
    if (input.scriptHex !== policyScriptHex) throw new Error('reserved input is not vault-policy-v1')
    const outpoint = `${input.txid}:${input.vout.toString(16).padStart(8, '0')}`
    if (previousOutpoint && outpoint <= previousOutpoint) {
      throw new Error(outpoint === previousOutpoint ? 'duplicate reserved input' : 'reserved inputs are not canonical')
    }
    previousOutpoint = outpoint
    inputTotal += BigInt(input.valueSats)
    if (inputTotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('reserved input total overflows safe sats')
  }

  const requiredTotal = BigInt(amountSats) + BigInt(reserve.feeSats) + BigInt(reserve.changeSats)
  if (inputTotal !== requiredTotal) throw new Error('reserved input total does not conserve value')
  if (reserve.destScript.toLowerCase() !== hex.encode(vtxoDestinationScript(status, destAddress))) {
    throw new Error('reserved destination does not match the requested address')
  }
  const outputs = [
    {
      script: requireHex(reserve.destScript, reserve.destScript.length / 2, 'destination script'),
      amount: BigInt(amountSats),
    },
  ]
  if (reserve.changeSats === 0) {
    if (reserve.changeVout !== undefined || reserve.changeAddress !== '' || reserve.changeScript !== '') {
      throw new Error('zero change must omit all change output facts')
    }
  } else {
    if (reserve.changeSats < VTXO_DUST_SATS) throw new Error('VTXO change is below dust')
    if (reserve.changeVout !== 1) throw new Error('change output index is not canonical')
    if (reserve.changeScript !== policyScriptHex) throw new Error('change is not vault-policy-v1')
    if (reserve.changeAddress !== status.spendingArkAddress) throw new Error('change address is not vault-policy-v1')
    outputs.push({ script: requireHex(reserve.changeScript, 34, 'change script'), amount: BigInt(reserve.changeSats) })
  }
  const unroll = CSVMultisigTapscript.decode(
    requireHex(reserve.checkpointTapscript, reserve.checkpointTapscript.length / 2, 'checkpoint tapscript'),
  )
  return buildOffchainTx(
    reserve.inputs.map((input) => ({
      txid: input.txid,
      vout: input.vout,
      value: input.valueSats,
      tapLeafScript: script.forfeit(),
      tapTree: script.encode(),
    })),
    outputs,
    unroll,
  )
}

export const VTXO_GET_PENDING_MESSAGE: Intent.GetPendingTxMessage = {
  type: 'get-pending-tx',
  expire_at: 0,
}

type PsbtInput = ReturnType<Transaction['getInput']>

function sameOptionalBytes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  return a === undefined ? b === undefined : b !== undefined && sameBytes(a, b)
}

function sameTapLeafScripts(a: PsbtInput['tapLeafScript'], b: PsbtInput['tapLeafScript']): boolean {
  if (a === undefined || b === undefined) return a === b
  return (
    a.length === b.length &&
    a.every(([leftControl, leftScript], index) => {
      const right = b[index]
      return Boolean(
        right &&
          leftControl.version === right[0].version &&
          sameBytes(leftControl.internalKey, right[0].internalKey) &&
          leftControl.merklePath.length === right[0].merklePath.length &&
          leftControl.merklePath.every((node, nodeIndex) => sameBytes(node, right[0].merklePath[nodeIndex])) &&
          sameBytes(leftScript, right[1]),
      )
    })
  )
}

function requireInputShapeMatches(expected: PsbtInput, candidate: PsbtInput, context: string) {
  if (
    !sameOptionalBytes(expected.txid, candidate.txid) ||
    expected.index !== candidate.index ||
    expected.sequence !== candidate.sequence ||
    expected.sighashType !== candidate.sighashType ||
    !sameOptionalBytes(expected.tapInternalKey, candidate.tapInternalKey) ||
    !sameOptionalBytes(expected.tapMerkleRoot, candidate.tapMerkleRoot)
  ) {
    throw new Error(`${context} changed an input`)
  }
  if (expected.witnessUtxo === undefined || candidate.witnessUtxo === undefined) {
    if (expected.witnessUtxo !== candidate.witnessUtxo) throw new Error(`${context} changed an input prevout`)
  } else if (
    expected.witnessUtxo.amount !== candidate.witnessUtxo.amount ||
    !sameBytes(expected.witnessUtxo.script, candidate.witnessUtxo.script)
  ) {
    throw new Error(`${context} changed an input prevout`)
  }
  if (!sameTapLeafScripts(expected.tapLeafScript, candidate.tapLeafScript)) {
    throw new Error(`${context} changed an input tapleaf`)
  }
}

function pendingProofFromCheckpoints(unsignedCheckpointPsbts: string[]): Transaction {
  if (unsignedCheckpointPsbts.length < 1 || unsignedCheckpointPsbts.length > MAX_VTXO_INPUTS) {
    throw new Error('pending proof requires the exact reserved checkpoints')
  }
  const inputs = unsignedCheckpointPsbts.map((raw) => {
    const checkpoint = Transaction.fromPSBT(base64.decode(raw))
    if (checkpoint.inputsLength !== 1) throw new Error('pending proof checkpoint must have one input')
    return checkpoint.getInput(0)
  })
  return Intent.create(VTXO_GET_PENDING_MESSAGE, inputs, [])
}

function pendingProofWithoutTapscriptSignatures(proof: Transaction): Uint8Array {
  const unsigned = proof.clone()
  for (let index = 0; index < unsigned.inputsLength; index++) {
    unsigned.updateInput(index, { tapScriptSig: undefined }, true)
  }
  return unsigned.toPSBT()
}

function requireExactTapscriptSigners(
  proof: Transaction,
  inputIndex: number,
  expectedPubkeys: Uint8Array[],
  allowedSighashTypes?: number[],
) {
  const signatures = proof.getInput(inputIndex).tapScriptSig || []
  const actual = signatures.map(([data]) => hex.encode(data.pubKey)).sort()
  const expected = expectedPubkeys.map(hex.encode).sort()
  if (actual.length !== expected.length || actual.some((pubkey, index) => pubkey !== expected[index])) {
    throw new Error('pending proof has the wrong signer set')
  }
  verifyTapscriptSignatures(proof, inputIndex, expected, undefined, allowedSighashTypes)
}

export async function createPhoneSignedPendingProof(
  unsignedCheckpointPsbts: string[],
  identity: Pick<SingleKey, 'sign'>,
  phonePub: Uint8Array,
): Promise<string> {
  const proof = await identity.sign(pendingProofFromCheckpoints(unsignedCheckpointPsbts))
  for (let index = 0; index < proof.inputsLength; index++) {
    requireExactTapscriptSigners(proof, index, [phonePub], [SigHash.ALL])
  }
  return base64.encode(proof.toPSBT())
}

/** Rebuild the canonical proof and require exactly the phone and VaultCosigner signatures. */
export function requireAuthorizedPendingProof(
  unsignedCheckpointPsbts: string[],
  authorizedPendingProof: string,
  status: VaultStatus,
): string {
  const expected = pendingProofFromCheckpoints(unsignedCheckpointPsbts)
  const candidate = Transaction.fromPSBT(base64.decode(authorizedPendingProof))
  if (
    candidate.id !== expected.id ||
    candidate.inputsLength !== expected.inputsLength ||
    candidate.outputsLength !== expected.outputsLength
  ) {
    throw new Error('Vault authorization changed the pending proof')
  }
  for (let index = 0; index < expected.inputsLength; index++) {
    requireInputShapeMatches(expected.getInput(index), candidate.getInput(index), 'Vault authorization')
  }
  if (!sameBytes(pendingProofWithoutTapscriptSignatures(expected), pendingProofWithoutTapscriptSignatures(candidate))) {
    throw new Error('Vault authorization changed the pending proof PSBT')
  }
  const phonePub = xOnly(status.phoneBip340Pub, 'phone pubkey')
  const vaultPub = xOnly(status.vtxoVaultCosignerPub, 'VTXO VaultCosigner pubkey')
  for (let index = 0; index < candidate.inputsLength; index++) {
    requireExactTapscriptSigners(candidate, index, [phonePub, vaultPub], [SigHash.ALL])
  }
  return base64.encode(candidate.toPSBT())
}

function requireCheckpointShapeMatches(original: Transaction, candidate: Transaction) {
  if (original.id !== candidate.id || original.inputsLength !== 1 || candidate.inputsLength !== 1) {
    throw new Error('Operator changed the checkpoint transaction')
  }
  const expected = original.getInput(0)
  const submitted = candidate.getInput(0)
  if (
    !expected.witnessUtxo ||
    !submitted.witnessUtxo ||
    expected.witnessUtxo.amount !== submitted.witnessUtxo.amount ||
    !sameBytes(expected.witnessUtxo.script, submitted.witnessUtxo.script)
  ) {
    throw new Error('Operator changed the checkpoint prevout')
  }
  if (
    expected.tapLeafScript?.length !== 1 ||
    submitted.tapLeafScript?.length !== 1 ||
    !sameBytes(expected.tapLeafScript[0][1], submitted.tapLeafScript[0][1])
  ) {
    throw new Error('Operator changed the checkpoint tapleaf')
  }
}

export function requireOperatorSignedCheckpoint(
  original: Transaction,
  candidate: Transaction,
  operatorPub: Uint8Array,
) {
  requireCheckpointShapeMatches(original, candidate)
  const submitted = candidate.getInput(0)
  const signatures = submitted.tapScriptSig
  if (signatures?.length !== 1 || !sameBytes(signatures[0][0].pubKey, operatorPub)) {
    throw new Error('checkpoint requires exactly the Operator signature')
  }
  verifyTapscriptSignatures(candidate, 0, [hex.encode(operatorPub)])
}

function checkpointPairsInCanonicalOrder(
  expectedCheckpointPsbts: string[],
  candidateCheckpointPsbts: string[],
  context: string,
): { original: Transaction; candidate: Transaction }[] {
  if (candidateCheckpointPsbts.length !== expectedCheckpointPsbts.length) {
    throw new Error(`${context} returned the wrong checkpoint count`)
  }
  const candidates = new Map<string, Transaction>()
  for (const raw of candidateCheckpointPsbts) {
    const candidate = Transaction.fromPSBT(base64.decode(raw))
    if (candidates.has(candidate.id)) throw new Error(`${context} returned a duplicate checkpoint`)
    candidates.set(candidate.id, candidate)
  }
  const expectedIds = new Set<string>()
  const ordered = expectedCheckpointPsbts.map((raw) => {
    const original = Transaction.fromPSBT(base64.decode(raw))
    if (expectedIds.has(original.id)) throw new Error('local checkpoint identity is duplicated')
    expectedIds.add(original.id)
    const candidate = candidates.get(original.id)
    if (!candidate) throw new Error(`${context} returned an unknown or missing checkpoint`)
    requireCheckpointShapeMatches(original, candidate)
    candidates.delete(original.id)
    return { original, candidate }
  })
  if (candidates.size !== 0) throw new Error(`${context} returned an unknown checkpoint`)
  return ordered
}

/** Match by witness-independent checkpoint txid and restore reserved input order. */
export function matchOperatorSignedCheckpoints(
  expectedCheckpointPsbts: string[],
  candidateCheckpointPsbts: string[],
  operatorPub: Uint8Array,
): string[] {
  return checkpointPairsInCanonicalOrder(expectedCheckpointPsbts, candidateCheckpointPsbts, 'Operator').map(
    ({ original, candidate }) => {
      requireOperatorSignedCheckpoint(original, candidate, operatorPub)
      return base64.encode(candidate.toPSBT())
    },
  )
}

type OperatorPendingTx = Awaited<ReturnType<ArkProvider['getPendingTxs']>>[number]

/** Validate the exact retained Operator result before advancing a persisted operation. */
export function matchPendingOperatorSubmission(
  pending: PersistedVtxoSpend,
  candidates: OperatorPendingTx[],
  status: VaultStatus,
  operatorPub: Uint8Array,
): { arkTxid: string; operatorCheckpointPsbts: string[] } {
  if (!pending.unsignedArkPsbt || !pending.unsignedCheckpointPsbts?.length) {
    throw new Error('persisted VTXO spend is missing its original transaction bundle')
  }
  if (candidates.length !== 1) throw new Error('Operator pending lookup did not return exactly one transaction')
  const candidate = candidates[0]
  if (candidate.arkTxid !== pending.arkTxid) throw new Error('Operator pending lookup returned another transaction')
  const originalArk = Transaction.fromPSBT(base64.decode(pending.unsignedArkPsbt))
  const finalArk = Transaction.fromPSBT(base64.decode(candidate.finalArkTx))
  if (
    originalArk.id !== pending.arkTxid ||
    finalArk.id !== pending.arkTxid ||
    finalArk.inputsLength !== originalArk.inputsLength ||
    finalArk.outputsLength !== originalArk.outputsLength
  ) {
    throw new Error('Operator pending lookup changed the Ark transaction')
  }
  const expectedArkSigners = [
    xOnly(status.phoneBip340Pub, 'phone pubkey'),
    xOnly(status.vtxoVaultCosignerPub, 'VTXO VaultCosigner pubkey'),
    operatorPub,
  ]
  for (let index = 0; index < originalArk.inputsLength; index++) {
    requireInputShapeMatches(originalArk.getInput(index), finalArk.getInput(index), 'Operator pending lookup')
    requireExactTapscriptSigners(finalArk, index, expectedArkSigners)
  }
  return {
    arkTxid: candidate.arkTxid,
    operatorCheckpointPsbts: matchOperatorSignedCheckpoints(
      pending.unsignedCheckpointPsbts,
      candidate.signedCheckpointTxs,
      operatorPub,
    ),
  }
}

/** Restore canonical checkpoint order after the VaultCosigner adds signatures. */
export function orderAuthorizedCheckpoints(
  expectedCheckpointPsbts: string[],
  candidateCheckpointPsbts: string[],
): string[] {
  return checkpointPairsInCanonicalOrder(expectedCheckpointPsbts, candidateCheckpointPsbts, 'Vault service').map(
    ({ candidate }) => base64.encode(candidate.toPSBT()),
  )
}

export function requireUserSignedArkInputs(arkTx: Transaction, userPub: Uint8Array) {
  for (let index = 0; index < arkTx.inputsLength; index++) {
    verifyTapscriptSignatures(arkTx, index, [hex.encode(userPub)])
  }
}

async function finalizeVaultOperation(vaultId: string, operationId: string, bundleDigest: string, arkTxid: string) {
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const result = await vaultPost<VtxoFinalizeResponse>('/v1/vtxo/finalize', {
        vaultId,
        operationId,
        bundleDigest,
        arkTxid,
      })
      if (result.state !== 'finalized' || result.arkTxid !== arkTxid)
        throw new Error('invalid VTXO finalization receipt')
      return
    } catch (err) {
      lastError = err
      if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('VTXO finalization receipt unavailable')
}

export function pendingVtxoSpendBlocksNewSend(pending: PersistedVtxoSpend | undefined): boolean {
  return Boolean(pending)
}

export function isSameVtxoPayment(pending: PersistedVtxoSpend, destAddress: string, amountSats: number): boolean {
  return pending.destAddress === destAddress.trim() && pending.amountSats === amountSats
}

export async function withVtxoSendLock<T>(
  vaultId: string,
  run: () => Promise<T>,
  locks: VaultLockManager | null | undefined = browserVaultLockManager(),
): Promise<T> {
  return requireVaultLockManager(locks).request(
    `arkade-vault-vtxo-send:${vaultId}`,
    { mode: 'exclusive' },
    async (lock) => {
      if (!lock) throw new Error('Web Locks API returned no exclusive send lock')
      return run()
    },
  )
}

export function fetchVtxoOperation(vaultId: string, operationId: string): Promise<VtxoOperationView> {
  return vaultGet<VtxoOperationView>(
    `/v1/vtxo/operation?vaultId=${encodeURIComponent(vaultId)}&operationId=${encodeURIComponent(operationId)}`,
  )
}

function operationNotFound(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase()
  return msg.includes('not found') || msg.includes('404')
}

const VTXO_SPEND_STAGE_RANK: Record<PersistedVtxoSpendStage, number> = {
  'pre-reserve': -1,
  reserved: 0,
  authorized: 1,
  'operator-submitted': 2,
  'checkpoints-authorized': 3,
  'operator-finalized': 4,
}

export function laterVtxoSpendStage(
  current: PersistedVtxoSpendStage,
  incoming: PersistedVtxoSpendStage,
): PersistedVtxoSpendStage {
  return VTXO_SPEND_STAGE_RANK[incoming] > VTXO_SPEND_STAGE_RANK[current] ? incoming : current
}

function stageFloorFromOperationView(state: VtxoOperationState): PersistedVtxoSpendStage | undefined {
  switch (state) {
    case 'reserved':
      return 'reserved'
    case 'signed':
      return 'authorized'
    case 'submitted':
      return 'checkpoints-authorized'
    case 'finalized':
      return 'operator-finalized'
    default:
      return undefined
  }
}

function requireRecoveryProofForAuthorizedSpend(pending: PersistedVtxoSpend) {
  if (VTXO_SPEND_STAGE_RANK[pending.stage] >= VTXO_SPEND_STAGE_RANK.authorized && !pending.authorizedPendingProof) {
    throw new VtxoSpendInFlightError(pending.arkTxid, pending.operationId)
  }
}

/** Map a read-only operation view onto the local durable record. Never moves stage backward. */
export function applyVtxoOperationView(
  pending: PersistedVtxoSpend,
  view: VtxoOperationView,
): PersistedVtxoSpend | undefined {
  if (view.operationId !== pending.operationId) throw new Error('VTXO operation id mismatch')
  if (pending.stage === 'pre-reserve') {
    if (view.state === 'aborted') {
      clearPersistedVtxoSpend(pending.vaultId)
      return undefined
    }
    if (view.state === 'reserved') return pending
    persistVtxoSpend(pending)
    throw new VtxoSpendUnresolvedError(view.arkTxid || '', pending.operationId)
  }
  if (view.bundleDigest && view.bundleDigest !== pending.bundleDigest) {
    throw new Error('VTXO operation digest mismatch')
  }
  const arkTxid = view.arkTxid || pending.arkTxid
  switch (view.state) {
    case 'aborted':
      clearPersistedVtxoSpend(pending.vaultId)
      return undefined
    case 'unresolved':
      persistVtxoSpend({ ...pending, arkTxid })
      throw new VtxoSpendUnresolvedError(arkTxid, pending.operationId)
    default: {
      const floor = stageFloorFromOperationView(view.state)
      if (!floor) return pending
      const checkpointPsbts = view.checkpointPsbts?.length
        ? orderAuthorizedCheckpoints(pending.unsignedCheckpointPsbts || [], view.checkpointPsbts)
        : pending.checkpointPsbts
      const next: PersistedVtxoSpend = {
        ...pending,
        arkTxid,
        authorizedPsbt: view.authorizedPsbt || pending.authorizedPsbt,
        authorizedPendingProof: view.authorizedPendingProof || pending.authorizedPendingProof,
        checkpointPsbts,
        stage: laterVtxoSpendStage(pending.stage, floor),
      }
      persistVtxoSpend(next)
      return next
    }
  }
}

async function syncPersistedSpendWithOperation(pending: PersistedVtxoSpend): Promise<PersistedVtxoSpend | undefined> {
  let view: VtxoOperationView
  try {
    view = await fetchVtxoOperation(pending.vaultId, pending.operationId)
  } catch (err) {
    if (operationNotFound(err)) {
      return pending
    }
    return pending
  }
  return applyVtxoOperationView(pending, view)
}

async function reservePersistedVtxoSpend(
  enrollment: EnrollmentSecrets,
  status: VaultStatus,
  pending: PersistedVtxoSpend,
): Promise<PersistedVtxoSpend> {
  if (!pending.reservePhoneSignature) {
    if (
      !sameBytes(
        xOnly(enrollment.phoneBip340Pub, 'enrollment phone pubkey'),
        xOnly(status.phoneBip340Pub, 'phone pubkey'),
      )
    ) {
      throw new Error('enrollment phone key does not match this vault')
    }
    const phoneSecret = await unlockPhoneBip340(enrollment, status)
    try {
      pending = persistVtxoReserveSignature(pending, status, phoneSecret)
    } finally {
      zeroBytes(phoneSecret)
    }
  }
  const reserve = await vaultPost<VtxoReserveResponse>('/v1/vtxo/reserve', vtxoReserveRequest(pending, status))
  if (reserve.operationId !== pending.operationId) throw new Error('VTXO reservation returned a different operation id')
  const operator = new RestArkProvider(vaultArkServer())
  const info = await requirePinnedOperator(operator, status, reserve.checkpointTapscript)
  const expectedFeePolicyDigest = arkadeIntentFeePolicyDigest(info.fees.intentFee)
  const offchain = buildReservedVtxoSpend(
    status,
    reserve,
    pending.amountSats,
    pending.destAddress,
    expectedFeePolicyDigest,
  )
  const next: PersistedVtxoSpend = {
    ...pending,
    bundleDigest: reserve.bundleDigest,
    arkTxid: offchain.arkTx.id,
    reservationExpires: reserve.reservationExpires,
    checkpointTapscript: reserve.checkpointTapscript,
    stage: 'reserved',
    unsignedArkPsbt: base64.encode(offchain.arkTx.toPSBT()),
    unsignedCheckpointPsbts: offchain.checkpoints.map((checkpoint) => base64.encode(checkpoint.toPSBT())),
    feePolicyDigest: reserve.feePolicyDigest,
    feeSats: reserve.feeSats,
    changeSats: reserve.changeSats,
    ...(reserve.changeVout === undefined ? {} : { changeVout: reserve.changeVout }),
  }
  persistVtxoSpend(next)
  return next
}

function quoteFromPersistedVtxoSpend(pending: PersistedVtxoSpend): VaultVtxoSpendQuote {
  if (
    !pending.feePolicyDigest ||
    pending.feeSats === undefined ||
    pending.changeSats === undefined ||
    !persistedReservationFactsAreValid(pending)
  ) {
    throw new Error('persisted VTXO reservation is missing fee or change facts')
  }
  return {
    operationId: pending.operationId,
    feeSats: pending.feeSats,
    feePolicyDigest: pending.feePolicyDigest,
    changeSats: pending.changeSats,
    ...(pending.changeVout === undefined ? {} : { changeVout: pending.changeVout }),
  }
}

async function prepareVtxoSpendLocked(
  enrollment: EnrollmentSecrets,
  status: VaultStatus,
  destAddress: string,
  amountSats: number,
): Promise<PersistedVtxoSpend> {
  let pending = loadPersistedVtxoSpend(status.vaultId)
  if (pending) pending = await syncPersistedSpendWithOperation(pending)
  if (pending && !isSameVtxoPayment(pending, destAddress, amountSats)) {
    throw new VtxoSpendInFlightError(pending.arkTxid, pending.operationId)
  }
  if (!pending) pending = preReserveVtxoSpend(status.vaultId, destAddress, amountSats)
  if (pending.stage === 'pre-reserve') pending = await reservePersistedVtxoSpend(enrollment, status, pending)
  return pending
}

/** Reserve and validate the authoritative fee before the wallet presents Review. */
export async function reserveVaultVtxo(
  enrollment: EnrollmentSecrets,
  status: VaultStatus,
  destAddress: string,
  amountSats: number,
): Promise<VaultVtxoSpendQuote> {
  requireMutinynetStatus(status)
  if (!Number.isSafeInteger(amountSats) || amountSats < VTXO_DUST_SATS) throw new Error('VTXO amount is below dust')
  return withVtxoSendLock(status.vaultId, async () =>
    quoteFromPersistedVtxoSpend(await prepareVtxoSpendLocked(enrollment, status, destAddress, amountSats)),
  )
}

export type VtxoSpendReconcile =
  | { kind: 'idle' }
  | { kind: 'pending'; operationId: string; stage: PersistedVtxoSpendStage }
  | { kind: 'receipt-finalized'; txid: string; operationId: string }

/** Finish vault-service receipt only. Never invents a newly approved payment. */
export async function reconcilePersistedVtxoSpend(status: VaultStatus): Promise<VtxoSpendReconcile> {
  requireMutinynetStatus(status)
  return withVtxoSendLock(status.vaultId, () => reconcilePersistedVtxoSpendLocked(status))
}

async function reconcilePersistedVtxoSpendLocked(status: VaultStatus): Promise<VtxoSpendReconcile> {
  let pending = loadPersistedVtxoSpend(status.vaultId)
  if (!pending) return { kind: 'idle' }
  const stageBeforeSync = pending.stage
  try {
    pending = await syncPersistedSpendWithOperation(pending)
  } catch (err) {
    if (err instanceof VtxoSpendUnresolvedError) {
      return { kind: 'pending', operationId: err.operationId, stage: stageBeforeSync }
    }
    throw err
  }
  if (!pending) return { kind: 'idle' }
  try {
    requireRecoveryProofForAuthorizedSpend(pending)
  } catch {
    return { kind: 'pending', operationId: pending.operationId, stage: pending.stage }
  }
  if (pending.stage === 'operator-finalized') {
    try {
      await finalizeVaultOperation(pending.vaultId, pending.operationId, pending.bundleDigest, pending.arkTxid)
      clearPersistedVtxoSpend(status.vaultId)
      return { kind: 'receipt-finalized', txid: pending.arkTxid, operationId: pending.operationId }
    } catch {
      return { kind: 'pending', operationId: pending.operationId, stage: pending.stage }
    }
  }
  if (pending.stage === 'checkpoints-authorized' && pending.checkpointPsbts?.length) {
    try {
      const operator = new RestArkProvider(vaultArkServer())
      await requireCurrentReservationPolicy(operator, status, pending)
      await operator.finalizeTx(pending.arkTxid, pending.checkpointPsbts)
      persistVtxoSpend({ ...pending, stage: 'operator-finalized' })
      await finalizeVaultOperation(pending.vaultId, pending.operationId, pending.bundleDigest, pending.arkTxid)
      clearPersistedVtxoSpend(status.vaultId)
      return { kind: 'receipt-finalized', txid: pending.arkTxid, operationId: pending.operationId }
    } catch {
      return { kind: 'pending', operationId: pending.operationId, stage: pending.stage }
    }
  }
  if (pending.stage === 'authorized' && pending.authorizedPsbt && pending.unsignedCheckpointPsbts?.length) {
    try {
      const operator = new RestArkProvider(vaultArkServer())
      const operatorInfo = await requireCurrentReservationPolicy(operator, status, pending)
      pending = await advanceAuthorizedVtxoSpend(
        operator,
        pending,
        status,
        xOnly(operatorInfo.signerPubkey, 'Operator signer pubkey'),
      )
      return { kind: 'pending', operationId: pending.operationId, stage: 'operator-submitted' }
    } catch {
      return { kind: 'pending', operationId: pending.operationId, stage: pending.stage }
    }
  }
  return { kind: 'pending', operationId: pending.operationId, stage: pending.stage }
}

async function finishOperatorFinalized(pending: PersistedVtxoSpend): Promise<VaultVtxoSpendResult> {
  const { feeSats } = quoteFromPersistedVtxoSpend(pending)
  await finalizeVaultOperation(pending.vaultId, pending.operationId, pending.bundleDigest, pending.arkTxid)
  clearPersistedVtxoSpend(pending.vaultId)
  return { txid: pending.arkTxid, operationId: pending.operationId, feeSats }
}

async function authorizeReservedVtxoSpend(
  enrollment: EnrollmentSecrets,
  status: VaultStatus,
  pending: PersistedVtxoSpend,
): Promise<PersistedVtxoSpend> {
  if (!pending.unsignedArkPsbt || !pending.unsignedCheckpointPsbts?.length) {
    throw new VtxoSpendInFlightError(pending.arkTxid, pending.operationId)
  }
  await requireCurrentReservationPolicy(new RestArkProvider(vaultArkServer()), status, pending)
  const auth = await authorizeWithPasskey(enrollment, status, pending.bundleDigest)
  try {
    const identity = SingleKey.fromPrivateKey(auth.phoneSecret)
    const arkTx = Transaction.fromPSBT(base64.decode(pending.unsignedArkPsbt))
    const userSignedArk = await identity.sign(arkTx)
    requireUserSignedArkInputs(userSignedArk, xOnly(status.phoneBip340Pub, 'phone pubkey'))
    const unsignedArkPsbt = base64.encode(userSignedArk.toPSBT())
    const pendingProof = await createPhoneSignedPendingProof(
      pending.unsignedCheckpointPsbts,
      identity,
      xOnly(status.phoneBip340Pub, 'phone pubkey'),
    )
    persistVtxoSpend({ ...pending, unsignedArkPsbt })
    const authorized = await vaultPost<VtxoAuthorizeResponse>('/v1/vtxo/authorize', {
      vaultId: status.vaultId,
      operationId: pending.operationId,
      bundleDigest: pending.bundleDigest,
      unsignedArkPsbt,
      unsignedCheckpointPsbts: pending.unsignedCheckpointPsbts,
      pendingProof,
      ...auth.assertion,
      directSig: auth.directSig,
    })
    if (
      authorized.operationId !== pending.operationId ||
      authorized.bundleDigest !== pending.bundleDigest ||
      !authorized.authorizedPsbt ||
      !authorized.authorizedPendingProof ||
      !authorized.arkTxid
    ) {
      throw new Error('invalid VTXO authorization response')
    }
    if (pending.arkTxid && authorized.arkTxid !== pending.arkTxid) {
      throw new Error('Vault authorization changed the Ark transaction')
    }
    const authorizedPendingProof = requireAuthorizedPendingProof(
      pending.unsignedCheckpointPsbts,
      authorized.authorizedPendingProof,
      status,
    )
    const next: PersistedVtxoSpend = {
      ...pending,
      unsignedArkPsbt,
      arkTxid: authorized.arkTxid,
      stage: 'authorized',
      authorizedPsbt: authorized.authorizedPsbt,
      authorizedPendingProof,
    }
    persistVtxoSpend(next)
    const persisted = loadPersistedVtxoSpend(next.vaultId)
    if (
      persisted?.operationId !== next.operationId ||
      persisted.stage !== 'authorized' ||
      persisted.authorizedPendingProof !== authorizedPendingProof
    ) {
      throw new Error('authorized pending proof was not durably persisted')
    }
    return persisted
  } finally {
    zeroBytes(auth.phoneSecret)
  }
}

function persistOperatorSubmission(
  pending: PersistedVtxoSpend,
  matched: ReturnType<typeof matchPendingOperatorSubmission>,
): PersistedVtxoSpend {
  const next: PersistedVtxoSpend = {
    ...pending,
    arkTxid: matched.arkTxid,
    stage: 'operator-submitted',
    operatorCheckpointPsbts: matched.operatorCheckpointPsbts,
  }
  persistVtxoSpend(next)
  return next
}

async function recoverAuthorizedVtxoSpend(
  operator: ArkProvider,
  pending: PersistedVtxoSpend,
  status: VaultStatus,
  operatorPub: Uint8Array,
  proof: string,
): Promise<PersistedVtxoSpend> {
  const candidates = await operator.getPendingTxs({ proof, message: VTXO_GET_PENDING_MESSAGE })
  return persistOperatorSubmission(pending, matchPendingOperatorSubmission(pending, candidates, status, operatorPub))
}

async function submitAuthorizedVtxoSpendOnce(
  operator: ArkProvider,
  pending: PersistedVtxoSpend,
  status: VaultStatus,
  operatorPub: Uint8Array,
): Promise<PersistedVtxoSpend> {
  if (!pending.authorizedPsbt || !pending.unsignedCheckpointPsbts?.length) {
    throw new VtxoSpendInFlightError(pending.arkTxid, pending.operationId)
  }
  const submitted = await operator.submitTx(pending.authorizedPsbt, pending.unsignedCheckpointPsbts)
  return persistOperatorSubmission(pending, matchPendingOperatorSubmission(pending, [submitted], status, operatorPub))
}

function persistOperatorSubmitAttempt(pending: PersistedVtxoSpend): PersistedVtxoSpend {
  const next = { ...pending, operatorSubmitAttempted: true }
  persistVtxoSpend(next)
  const persisted = loadPersistedVtxoSpend(next.vaultId)
  if (
    persisted?.operationId !== next.operationId ||
    persisted.stage !== 'authorized' ||
    persisted.operatorSubmitAttempted !== true
  ) {
    throw new Error('Operator submission attempt was not durably persisted')
  }
  return persisted
}

export async function advanceAuthorizedVtxoSpend(
  operator: ArkProvider,
  pending: PersistedVtxoSpend,
  status: VaultStatus,
  operatorPub: Uint8Array,
): Promise<PersistedVtxoSpend> {
  if (!pending.authorizedPendingProof) {
    throw new VtxoSpendInFlightError(pending.arkTxid, pending.operationId)
  }
  const proof = requireAuthorizedPendingProof(
    pending.unsignedCheckpointPsbts || [],
    pending.authorizedPendingProof,
    status,
  )
  if (pending.operatorSubmitAttempted) {
    return recoverAuthorizedVtxoSpend(operator, pending, status, operatorPub, proof)
  }
  const attempted = persistOperatorSubmitAttempt(pending)
  try {
    return await submitAuthorizedVtxoSpendOnce(operator, attempted, status, operatorPub)
  } catch {
    return recoverAuthorizedVtxoSpend(operator, attempted, status, operatorPub, proof)
  }
}

async function continueSameVtxoSpend(
  enrollment: EnrollmentSecrets,
  status: VaultStatus,
  pending: PersistedVtxoSpend,
): Promise<VaultVtxoSpendResult> {
  if (pending.stage === 'pre-reserve') pending = await reservePersistedVtxoSpend(enrollment, status, pending)
  requireRecoveryProofForAuthorizedSpend(pending)
  const operator = new RestArkProvider(vaultArkServer())
  if (pending.stage === 'operator-finalized') return finishOperatorFinalized(pending)
  if (pending.stage === 'checkpoints-authorized' && pending.checkpointPsbts?.length) {
    await requireCurrentReservationPolicy(operator, status, pending)
    await operator.finalizeTx(pending.arkTxid, pending.checkpointPsbts)
    persistVtxoSpend({ ...pending, stage: 'operator-finalized' })
    return finishOperatorFinalized({ ...pending, stage: 'operator-finalized' })
  }
  if (pending.stage === 'reserved') {
    pending = await authorizeReservedVtxoSpend(enrollment, status, pending)
  }
  if (pending.stage === 'authorized' && pending.authorizedPsbt && pending.unsignedCheckpointPsbts?.length) {
    const operatorInfo = await requireCurrentReservationPolicy(operator, status, pending)
    const operatorPub = xOnly(operatorInfo.signerPubkey, 'Operator signer pubkey')
    pending = await advanceAuthorizedVtxoSpend(operator, pending, status, operatorPub)
  }
  if (pending.stage !== 'operator-submitted' || !pending.operatorCheckpointPsbts?.length) {
    throw new VtxoSpendInFlightError(pending.arkTxid, pending.operationId)
  }
  const operatorInfo = await requireCurrentReservationPolicy(operator, status, pending)
  const auth = await authorizeWithPasskey(enrollment, status, pending.bundleDigest)
  try {
    const identity = SingleKey.fromPrivateKey(auth.phoneSecret)
    const userAndOperatorCheckpoints: string[] = []
    for (const [index, raw] of pending.operatorCheckpointPsbts.entries()) {
      const checkpoint = Transaction.fromPSBT(base64.decode(raw))
      const original = pending.unsignedCheckpointPsbts?.[index]
        ? Transaction.fromPSBT(base64.decode(pending.unsignedCheckpointPsbts[index]))
        : checkpoint
      requireOperatorSignedCheckpoint(original, checkpoint, xOnly(operatorInfo.signerPubkey, 'Operator signer pubkey'))
      userAndOperatorCheckpoints.push(base64.encode((await identity.sign(checkpoint)).toPSBT()))
    }
    const checkpoints = await vaultPost<VtxoCheckpointAuthorizeResponse>('/v1/vtxo/checkpoints/authorize', {
      vaultId: status.vaultId,
      operationId: pending.operationId,
      bundleDigest: pending.bundleDigest,
      checkpointPsbts: userAndOperatorCheckpoints,
    })
    if (
      checkpoints.operationId !== pending.operationId ||
      checkpoints.bundleDigest !== pending.bundleDigest ||
      checkpoints.arkTxid !== pending.arkTxid
    ) {
      throw new Error('invalid checkpoint authorization response')
    }
    const checkpointPsbts = orderAuthorizedCheckpoints(userAndOperatorCheckpoints, checkpoints.checkpointPsbts)
    persistVtxoSpend({ ...pending, stage: 'checkpoints-authorized', checkpointPsbts })
    await requireCurrentReservationPolicy(operator, status, pending)
    await operator.finalizeTx(pending.arkTxid, checkpointPsbts)
    persistVtxoSpend({ ...pending, stage: 'operator-finalized', checkpointPsbts })
    try {
      await finalizeVaultOperation(status.vaultId, pending.operationId, pending.bundleDigest, pending.arkTxid)
    } catch {
      throw new VtxoReceiptPendingError(
        pending.arkTxid,
        pending.operationId,
        quoteFromPersistedVtxoSpend(pending).feeSats,
      )
    }
    clearPersistedVtxoSpend(status.vaultId)
    return {
      txid: pending.arkTxid,
      operationId: pending.operationId,
      feeSats: quoteFromPersistedVtxoSpend(pending).feeSats,
    }
  } finally {
    zeroBytes(auth.phoneSecret)
  }
}

export async function sendVaultVtxo(
  enrollment: EnrollmentSecrets,
  status: VaultStatus,
  destAddress: string,
  amountSats: number,
): Promise<VaultVtxoSpendResult> {
  requireMutinynetStatus(status)
  if (!Number.isSafeInteger(amountSats) || amountSats < VTXO_DUST_SATS) throw new Error('VTXO amount is below dust')
  return withVtxoSendLock(status.vaultId, async () => {
    const pending = await prepareVtxoSpendLocked(enrollment, status, destAddress, amountSats)
    return continueSameVtxoSpend(enrollment, status, pending)
  })
}

export async function fetchVaultVtxoFunds(status: VaultStatus): Promise<{ balance: number }> {
  requireMutinynetStatus(status)
  const script = vaultPolicyV1ScriptFromStatus(status)
  const provider = new RestIndexerProvider(vaultArkServer())
  const scripts = [hex.encode(script.pkScript)]
  const vtxos = uniqueVtxosByOutpoint(
    await collectPagedVtxos((pageIndex) =>
      provider.getVtxos({ scripts, spendableOnly: true, ...vaultVtxoPage(pageIndex) }),
    ),
  )
  return {
    balance: vtxos.reduce((sum, vtxo) => sum + vtxo.value, 0),
  }
}

export type VtxoIndexerPage = { current: number; next: number; total: number }

const MAX_VTXO_HISTORY_PAGES = 256
export const VAULT_VTXO_PAGE_SIZE = 100

export function vaultVtxoPage(pageIndex: number): { pageIndex: number; pageSize: number } {
  return { pageIndex, pageSize: VAULT_VTXO_PAGE_SIZE }
}

export function uniqueVtxosByOutpoint<T extends { txid: string; vout: number }>(vtxos: T[]): T[] {
  const unique = new Map<string, T>()
  for (const vtxo of vtxos) unique.set(`${vtxo.txid}:${vtxo.vout}`, vtxo)
  return [...unique.values()]
}

export async function collectPagedVtxos<T>(
  fetchPage: (pageIndex: number) => Promise<{ vtxos: T[]; page?: VtxoIndexerPage }>,
): Promise<T[]> {
  const all: T[] = []
  const seen = new Set<number>()
  let pageIndex = 0
  for (;;) {
    if (seen.has(pageIndex) || seen.size >= MAX_VTXO_HISTORY_PAGES) break
    seen.add(pageIndex)
    const { vtxos, page } = await fetchPage(pageIndex)
    all.push(...vtxos)
    if (!page || page.current + 1 >= page.total || page.next <= page.current) break
    pageIndex = page.next
  }
  return all
}

export async function fetchVaultVtxoHistory(status: VaultStatus): Promise<VaultHistoryItem[]> {
  requireMutinynetStatus(status)
  const script = vaultPolicyV1ScriptFromStatus(status)
  const provider = new RestIndexerProvider(vaultArkServer())
  const scripts = [hex.encode(script.pkScript)]
  const vtxos = await collectPagedVtxos((pageIndex) => provider.getVtxos({ scripts, ...vaultVtxoPage(pageIndex) }))
  return historyFromVtxos(vtxos.map(vaultVtxoHistoryCoin))
}

export function vaultVtxoHistoryCoin(vtxo: {
  txid: string
  vout: number
  value: number
  createdAt: Date | string | number
  isSpent?: boolean
  spentBy?: string
  arkTxId?: string
  commitmentTxIds?: string[]
  status?: { isLeaf?: boolean }
  settledBy?: string
}): Parameters<typeof historyFromVtxos>[0][number] {
  return {
    txid: vtxo.txid,
    vout: vtxo.vout,
    value: vtxo.value,
    createdAtMs: vtxo.createdAt instanceof Date ? vtxo.createdAt.getTime() : Number(vtxo.createdAt) || 0,
    isSpent: Boolean(vtxo.isSpent || vtxo.spentBy || vtxo.settledBy),
    arkTxId: vtxo.arkTxId,
    commitmentTxIds: vtxo.commitmentTxIds,
    isLeaf: Boolean(vtxo.status?.isLeaf),
    settledBy: vtxo.settledBy,
  }
}

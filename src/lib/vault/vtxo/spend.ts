import {
  ArkAddress,
  buildOffchainTx,
  CSVMultisigTapscript,
  RestArkProvider,
  RestIndexerProvider,
  SingleKey,
  Transaction,
  type ArkProvider,
  verifyTapscriptSignatures,
} from '@arkade-os/sdk'
import { base64, hex } from '@scure/base'
import { testServer } from '../../constants'
import { vaultPost } from '../api'
import { deriveDirectP256, signDirectP256, zeroBytes } from '../ceremony/directauth.js'
import type { EnrollmentSecrets } from '../tenantEnrollment'
import type { VaultStatus } from '../types'
import { deviceSigningOptions, prfExtension, prfFrom } from '../webauthn'
import {
  VAULT_POLICY_V1_EXIT_DELAY,
  VAULT_POLICY_V1_EXIT_DELAY_UNIT,
  VaultPolicyV1Script,
  type VaultPolicyV1Params,
} from './script'

const PRF_SALT = new TextEncoder().encode('arkade-2fa-vault/prf/v1')
const HKDF_INFO = new TextEncoder().encode('arkade-2fa-vault/kek/v1')

export function vaultArkServer(production = import.meta.env.PROD): string {
  return production ? '/arkade' : testServer
}

export interface VtxoReserveResponse {
  operationId: string
  bundleDigest: string
  reservationExpires: string
  inputs: { txid: string; vout: number; valueSats: number; scriptHex: string }[]
  changeAddress: string
  changeScript: string
  destScript: string
  feeSats: number
  checkpointTapscript: string
}

interface VtxoAuthorizeResponse {
  operationId: string
  bundleDigest: string
  authorizedPsbt: string
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
}

export class VtxoReceiptPendingError extends Error {
  readonly txid: string
  readonly operationId: string

  constructor(txid: string, operationId: string) {
    super('VTXO finalization receipt unavailable')
    this.name = 'VtxoReceiptPendingError'
    this.txid = txid
    this.operationId = operationId
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

export function isVtxoReceiptPendingError(err: unknown): err is VtxoReceiptPendingError {
  return err instanceof VtxoReceiptPendingError
}

export function isVtxoSpendInFlightError(err: unknown): err is VtxoSpendInFlightError {
  return err instanceof VtxoSpendInFlightError
}

export type PersistedVtxoSpendStage =
  | 'authorized'
  | 'operator-submitted'
  | 'checkpoints-authorized'
  | 'operator-finalized'

export interface PersistedVtxoSpend {
  vaultId: string
  operationId: string
  bundleDigest: string
  destAddress: string
  amountSats: number
  arkTxid: string
  stage: PersistedVtxoSpendStage
  authorizedPsbt?: string
  unsignedCheckpointPsbts?: string[]
  checkpointPsbts?: string[]
}

export function vtxoSpendStorageKey(vaultId: string): string {
  return `arkade-vault-vtxo-spend:${vaultId}`
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
      parsed.operationId &&
      parsed.bundleDigest &&
      parsed.arkTxid &&
      parsed.stage &&
      parsed.destAddress &&
      typeof parsed.amountSats === 'number'
    ) {
      return parsed as PersistedVtxoSpend
    }
  } catch {
    return undefined
  }
  return undefined
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
    userPub: xOnly(status.phoneRoutineBip340Pub, 'phone routine pubkey'),
    vtxoVaultCosignerPub: xOnly(status.vtxoVaultCosignerPub, 'VTXO VaultCosigner pubkey'),
    arkdServerPub: address.serverPubKey,
    delegatePub: xOnly(status.vtxoDelegatePub, 'delegate pubkey'),
    exitDelay: VAULT_POLICY_V1_EXIT_DELAY,
    exitDelayUnit: VAULT_POLICY_V1_EXIT_DELAY_UNIT,
    exitDevicePub: xOnly(status.phoneRoutineBip340Pub, 'phone routine pubkey'),
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
    if (hex.encode(await identity.compressedPublicKey()) !== enrollment.phoneRoutineBip340Pub) {
      zeroBytes(phoneSecret)
      throw new Error('phone routine key does not match this vault')
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

function scriptForDestination(status: VaultStatus, destAddress: string): Uint8Array {
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

export function buildReservedVtxoSpend(
  status: VaultStatus,
  reserve: VtxoReserveResponse,
  amountSats: number,
  destAddress: string,
) {
  const script = vaultPolicyV1ScriptFromStatus(status)
  if (reserve.inputs.length !== 1) throw new Error('regular VTXO spend requires exactly one input')
  const input = reserve.inputs[0]
  if (input.scriptHex.toLowerCase() !== hex.encode(script.pkScript))
    throw new Error('reserved input is not vault-policy-v1')
  if (reserve.changeScript.toLowerCase() !== hex.encode(script.pkScript))
    throw new Error('change is not vault-policy-v1')
  if (reserve.changeAddress !== status.spendingArkAddress) throw new Error('change address is not vault-policy-v1')
  if (reserve.destScript.toLowerCase() !== hex.encode(scriptForDestination(status, destAddress))) {
    throw new Error('reserved destination does not match the requested address')
  }
  if (reserve.feeSats !== 0) throw new Error('regular VTXO slice only permits zero virtual fee')
  const change = input.valueSats - amountSats - reserve.feeSats
  if (!Number.isSafeInteger(change) || change < 330) throw new Error('VTXO change is below dust')
  const unroll = CSVMultisigTapscript.decode(
    requireHex(reserve.checkpointTapscript, reserve.checkpointTapscript.length / 2, 'checkpoint tapscript'),
  )
  return buildOffchainTx(
    [
      {
        txid: input.txid,
        vout: input.vout,
        value: input.valueSats,
        tapLeafScript: script.forfeit(),
        tapTree: script.encode(),
      },
    ],
    [
      {
        script: requireHex(reserve.destScript, reserve.destScript.length / 2, 'destination script'),
        amount: BigInt(amountSats),
      },
      { script: requireHex(reserve.changeScript, 34, 'change script'), amount: BigInt(change) },
    ],
    unroll,
  )
}

export function requireOperatorSignedCheckpoint(
  original: Transaction,
  candidate: Transaction,
  operatorPub: Uint8Array,
) {
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
  const signatures = submitted.tapScriptSig
  if (signatures?.length !== 1 || !sameBytes(signatures[0][0].pubKey, operatorPub)) {
    throw new Error('checkpoint requires exactly the Operator signature')
  }
  verifyTapscriptSignatures(candidate, 0, [hex.encode(operatorPub)])
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

export type VtxoSpendReconcile =
  | { kind: 'idle' }
  | { kind: 'pending'; operationId: string; stage: PersistedVtxoSpendStage }
  | { kind: 'receipt-finalized'; txid: string; operationId: string }

/** Finish vault-service receipt only. Never invents a newly approved payment. */
export async function reconcilePersistedVtxoSpend(status: VaultStatus): Promise<VtxoSpendReconcile> {
  requireMutinynetStatus(status)
  const pending = loadPersistedVtxoSpend(status.vaultId)
  if (!pending) return { kind: 'idle' }
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
      await operator.finalizeTx(pending.arkTxid, pending.checkpointPsbts)
      persistVtxoSpend({ ...pending, stage: 'operator-finalized' })
      await finalizeVaultOperation(pending.vaultId, pending.operationId, pending.bundleDigest, pending.arkTxid)
      clearPersistedVtxoSpend(status.vaultId)
      return { kind: 'receipt-finalized', txid: pending.arkTxid, operationId: pending.operationId }
    } catch {
      return { kind: 'pending', operationId: pending.operationId, stage: pending.stage }
    }
  }
  return { kind: 'pending', operationId: pending.operationId, stage: pending.stage }
}

export async function sendVaultVtxo(
  enrollment: EnrollmentSecrets,
  status: VaultStatus,
  destAddress: string,
  amountSats: number,
): Promise<VaultVtxoSpendResult> {
  requireMutinynetStatus(status)
  if (!Number.isSafeInteger(amountSats) || amountSats < 330) throw new Error('VTXO amount is below dust')
  const pending = loadPersistedVtxoSpend(status.vaultId)
  if (pendingVtxoSpendBlocksNewSend(pending)) {
    throw new VtxoSpendInFlightError(pending?.arkTxid || pending!.operationId, pending!.operationId)
  }
  const reserve = await vaultPost<VtxoReserveResponse>('/v1/vtxo/reserve', {
    vaultId: status.vaultId,
    purpose: 'spend',
    destAddress,
    amountSats,
  })
  const offchain = buildReservedVtxoSpend(status, reserve, amountSats, destAddress)
  const operator = new RestArkProvider(vaultArkServer())
  const operatorInfo = await requirePinnedOperator(operator, status, reserve.checkpointTapscript)
  const auth = await authorizeWithPasskey(enrollment, status, reserve.bundleDigest)
  try {
    const identity = SingleKey.fromPrivateKey(auth.phoneSecret)
    const userSignedArk = await identity.sign(offchain.arkTx)
    const authorized = await vaultPost<VtxoAuthorizeResponse>('/v1/vtxo/authorize', {
      vaultId: status.vaultId,
      operationId: reserve.operationId,
      bundleDigest: reserve.bundleDigest,
      unsignedArkPsbt: base64.encode(userSignedArk.toPSBT()),
      unsignedCheckpointPsbts: offchain.checkpoints.map((checkpoint) => base64.encode(checkpoint.toPSBT())),
      ...auth.assertion,
      directSig: auth.directSig,
    })
    if (
      authorized.operationId !== reserve.operationId ||
      authorized.bundleDigest !== reserve.bundleDigest ||
      !authorized.authorizedPsbt ||
      !authorized.arkTxid
    ) {
      throw new Error('invalid VTXO authorization response')
    }
    if (authorized.arkTxid !== offchain.arkTx.id) throw new Error('Vault authorization changed the Ark transaction')
    persistVtxoSpend({
      vaultId: status.vaultId,
      operationId: reserve.operationId,
      bundleDigest: reserve.bundleDigest,
      destAddress,
      amountSats,
      arkTxid: authorized.arkTxid,
      stage: 'authorized',
      authorizedPsbt: authorized.authorizedPsbt,
      unsignedCheckpointPsbts: offchain.checkpoints.map((checkpoint) => base64.encode(checkpoint.toPSBT())),
    })
    const submitted = await operator.submitTx(
      authorized.authorizedPsbt,
      offchain.checkpoints.map((checkpoint) => base64.encode(checkpoint.toPSBT())),
    )
    if (submitted.arkTxid !== authorized.arkTxid || submitted.signedCheckpointTxs.length !== 1) {
      throw new Error('Operator submission does not match the authorized VTXO transaction')
    }
    persistVtxoSpend({
      vaultId: status.vaultId,
      operationId: reserve.operationId,
      bundleDigest: reserve.bundleDigest,
      destAddress,
      amountSats,
      arkTxid: submitted.arkTxid,
      stage: 'operator-submitted',
      authorizedPsbt: authorized.authorizedPsbt,
    })
    try {
      const userAndOperatorCheckpoints: string[] = []
      for (const [index, raw] of submitted.signedCheckpointTxs.entries()) {
        const checkpoint = Transaction.fromPSBT(base64.decode(raw))
        requireOperatorSignedCheckpoint(
          offchain.checkpoints[index],
          checkpoint,
          xOnly(operatorInfo.signerPubkey, 'Operator signer pubkey'),
        )
        const signed = await identity.sign(checkpoint)
        userAndOperatorCheckpoints.push(base64.encode(signed.toPSBT()))
      }
      const checkpoints = await vaultPost<VtxoCheckpointAuthorizeResponse>('/v1/vtxo/checkpoints/authorize', {
        vaultId: status.vaultId,
        operationId: reserve.operationId,
        bundleDigest: reserve.bundleDigest,
        checkpointPsbts: userAndOperatorCheckpoints,
      })
      if (
        checkpoints.operationId !== reserve.operationId ||
        checkpoints.bundleDigest !== reserve.bundleDigest ||
        checkpoints.arkTxid !== submitted.arkTxid ||
        checkpoints.checkpointPsbts.length !== 1
      ) {
        throw new Error('invalid checkpoint authorization response')
      }
      persistVtxoSpend({
        vaultId: status.vaultId,
        operationId: reserve.operationId,
        bundleDigest: reserve.bundleDigest,
        destAddress,
        amountSats,
        arkTxid: submitted.arkTxid,
        stage: 'checkpoints-authorized',
        checkpointPsbts: checkpoints.checkpointPsbts,
      })
      await operator.finalizeTx(submitted.arkTxid, checkpoints.checkpointPsbts)
      persistVtxoSpend({
        vaultId: status.vaultId,
        operationId: reserve.operationId,
        bundleDigest: reserve.bundleDigest,
        destAddress,
        amountSats,
        arkTxid: submitted.arkTxid,
        stage: 'operator-finalized',
        checkpointPsbts: checkpoints.checkpointPsbts,
      })
      try {
        await finalizeVaultOperation(status.vaultId, reserve.operationId, reserve.bundleDigest, submitted.arkTxid)
      } catch {
        throw new VtxoReceiptPendingError(submitted.arkTxid, reserve.operationId)
      }
      clearPersistedVtxoSpend(status.vaultId)
      return { txid: submitted.arkTxid, operationId: reserve.operationId }
    } catch (err) {
      if (err instanceof VtxoReceiptPendingError) throw err
      throw new VtxoSpendInFlightError(submitted.arkTxid, reserve.operationId)
    }
  } finally {
    zeroBytes(auth.phoneSecret)
  }
}

export async function fetchVaultVtxoFunds(status: VaultStatus): Promise<{ balance: number; maxCoin: number }> {
  requireMutinynetStatus(status)
  const script = vaultPolicyV1ScriptFromStatus(status)
  const provider = new RestIndexerProvider(vaultArkServer())
  const { vtxos } = await provider.getVtxos({ scripts: [hex.encode(script.pkScript)], spendableOnly: true })
  return {
    balance: vtxos.reduce((sum, vtxo) => sum + vtxo.value, 0),
    maxCoin: vtxos.reduce((largest, vtxo) => Math.max(largest, vtxo.value), 0),
  }
}

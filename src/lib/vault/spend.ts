import { vaultPost } from './api'
import { loadAddressPin, requireStatusMatchesPin } from './pin'
import { fetchVaultStatus } from './status'
import { scriptHexFromAddress } from './bitcoin'
import { createAuthorizeRetryState } from './ceremony/authorizeretry.js'
import { deriveDirectP256, signDirectP256, verifyDirectP256, zeroBytes } from './ceremony/directauth.js'
import {
  assertArkadeChallenge,
  assertDirectP256,
  assertPhoneRoutineBIP340Pub,
  hexToBytes as ceremonyHex,
  phoneRoutineSignPSBT,
  validateAuthorizedPSBT,
  validateAuthorizeRetryPSBT,
  validateBoundPSBT,
  validateDraftPSBT,
} from './ceremony/psbtcheck.js'
import type { EnrollmentSecrets } from './tenantEnrollment'
import { bytesToHex, hexToBytes } from './hex'
import type { VaultStatus } from './types'
import { deviceSigningOptions, prfExtension, prfFrom } from './webauthn'

const PRF_SALT = new TextEncoder().encode('arkade-2fa-vault/prf/v1')
const HKDF_INFO = new TextEncoder().encode('arkade-2fa-vault/kek/v1')
const retry = createAuthorizeRetryState()

export function hasPendingRoutineSpend(): boolean {
  return retry.hasPending() === true
}

export interface LiveSpendInput {
  enrollment: EnrollmentSecrets
  status: VaultStatus
  destAddress: string
  amountSats: number
  feeSats: number
  prevTxHex: string
  vout: number
  afterPublish?: (published: { txid: string; phoneRoutineSecret: Uint8Array }) => Promise<string | void>
}

export interface LiveSpendResult {
  txid: string
  challenge: string
  followupTxid?: string
  followupError?: string
}

function requireRPID(status: VaultStatus): string {
  const rpId = String(status.rpId || '').toLowerCase()
  if (!rpId || rpId !== location.hostname.toLowerCase()) {
    throw new Error('deployment RP ID does not match this signing client host')
  }
  if (status.clientOrigin !== location.origin) {
    throw new Error('deployment origin does not match this signing client origin')
  }
  return rpId
}

function requirePinnedOperational(status: VaultStatus) {
  const vaultId = String(status.vaultId || '').trim()
  if (!vaultId) throw new Error('vault id required')
  const pin = loadAddressPin(localStorage, vaultId)
  if (!pin) throw new Error('deposit address is not pinned locally')
  requireStatusMatchesPin(status, pin)
  return pin
}

export async function sendRoutineSpend(input: LiveSpendInput): Promise<LiveSpendResult> {
  const { enrollment: rec, status } = input
  const vaultId = String(status.vaultId || rec.vaultId || '').trim()
  if (!vaultId) throw new Error('vault id required')
  const pin = requirePinnedOperational(status)
  const recipientScript = scriptHexFromAddress(input.destAddress, status.network)
  const intent = {
    prevTxHex: input.prevTxHex,
    vout: input.vout,
    recipientScript,
    recipientAmount: input.amountSats,
    fee: input.feeSats,
  }
  const reviewKey = JSON.stringify(intent)
  const validateServerRequest = (currentB64: string, requestB64: string, challengeHex: string) => {
    if (!requestB64) throw new Error('authorizer did not return the bound request')
    const request = validateAuthorizeRetryPSBT({
      currentB64,
      requestB64,
      prevTxHex: intent.prevTxHex,
      vout: String(intent.vout),
      recipientScript: intent.recipientScript,
      recipientAmount: String(intent.recipientAmount),
      fee: String(intent.fee),
      operationalScriptHex: pin.operationalScript,
      operationalAddress: pin.operationalAddress,
      network: status.network,
    })
    assertArkadeChallenge(challengeHex, request.arkadeChallenge)
    if (
      !verifyDirectP256(
        ceremonyHex(rec.phoneDirectP256, 33),
        ceremonyHex(challengeHex, 32),
        ceremonyHex(request.directSignature, 64),
      )
    ) {
      throw new Error('bound authorize request direct signature invalid')
    }
    return requestB64
  }
  retry.clearUnless(reviewKey)
  const already = retry.completedFor(reviewKey)
  if (already) {
    const published = await vaultPost<{ txid: string }>('/v1/publish', { vaultId, challenge: already.challengeHex })
    if (published.txid !== already.expectedTxid) {
      throw new Error('published txid does not match the authorized transaction')
    }
    return { txid: published.txid, challenge: already.challengeHex }
  }

  // A transport failure can happen after the server durably reserved the
  // exact PSBT. Re-submit the in-memory body before asking the authenticator
  // for new signature bytes or reconstructing the transaction. Boarding
  // settlement can resume separately after the L1 transaction is published.
  const pending = retry.pendingFor(reviewKey)
  if (pending) {
    const body = JSON.parse(pending.bodyJSON) as Record<string, unknown>
    const out = await vaultPost<{ requestPsbt: string; signedPsbt: string; replay?: boolean }>('/v1/authorize', {
      vaultId,
      ...body,
    })
    const requestB64 = validateServerRequest(
      String(pending.validation.submittedB64 || ''),
      out.requestPsbt,
      pending.challengeHex,
    )
    const authorized = validateAuthorizedPSBT({
      ...pending.validation,
      submittedB64: requestB64,
      authorizedB64: out.signedPsbt,
    })
    retry.markAuthorized(reviewKey, {
      challengeHex: pending.challengeHex,
      expectedTxid: authorized.transactionId,
      replay: out.replay === true,
    })
    const published = await vaultPost<{ txid: string }>('/v1/publish', {
      vaultId,
      challenge: pending.challengeHex,
    })
    if (published.txid !== authorized.transactionId) {
      throw new Error('published txid does not match the authorized transaction')
    }
    return { txid: published.txid, challenge: pending.challengeHex }
  }

  const draft = await vaultPost<{ psbt: string }>('/v1/draft', { ...intent, vaultId })
  const parsed = validateDraftPSBT({
    draftB64: draft.psbt,
    prevTxHex: intent.prevTxHex,
    vout: String(intent.vout),
    recipientScript: intent.recipientScript,
    recipientAmount: String(intent.recipientAmount),
    fee: String(intent.fee),
    operationalScriptHex: pin.operationalScript,
    operationalAddress: pin.operationalAddress,
    network: status.network,
  })
  const rpId = requireRPID(status)
  const pre = await vaultPost<{ challenge: string }>('/v1/preflight', { vaultId, psbt: draft.psbt })
  const challengeHex = assertArkadeChallenge(parsed.arkadeChallenge, pre.challenge)
  const challenge = ceremonyHex(challengeHex, 32)
  const credentialId = hexToBytes(rec.credId)
  const get = (await navigator.credentials.get({
    publicKey: deviceSigningOptions(
      {
        challenge,
        rpId,
        userVerification: 'required',
        extensions: prfExtension(PRF_SALT, credentialId),
      },
      credentialId,
    ),
  })) as PublicKeyCredential | null
  if (!get) throw new Error('The operation was aborted.')
  const prf = prfFrom(get)
  if (!prf || prf.length !== 32) throw new Error('authenticator did not return PRF')

  let scalar: Uint8Array | undefined
  let phoneRoutineSecret: Uint8Array | undefined
  try {
    const live = await fetchVaultStatus(undefined, vaultId)
    requireStatusMatchesPin(live, pin)
    assertPhoneRoutineBIP340Pub(rec.phoneRoutineBip340Pub, rec.phoneRoutineBip340Pub, live.phoneRoutineBip340Pub)
    assertDirectP256(rec.phoneDirectP256, rec.phoneDirectP256, live.phoneDirectP256)
    const derived = await deriveDirectP256(prf)
    scalar = derived.scalar
    assertDirectP256(bytesToHex(derived.pub), rec.phoneDirectP256, live.phoneDirectP256)
    const directSig = bytesToHex(signDirectP256(scalar, challenge))
    const assertion = {
      credentialId: rec.credId,
      clientDataJSON: bytesToHex(new Uint8Array(get.response.clientDataJSON)),
      authenticatorData: bytesToHex(new Uint8Array((get.response as AuthenticatorAssertionResponse).authenticatorData)),
      signature: bytesToHex(new Uint8Array((get.response as AuthenticatorAssertionResponse).signature)),
    }
    const bound = await vaultPost<{ psbt: string }>('/v1/bind', { vaultId, psbt: draft.psbt, directSig, ...assertion })
    validateBoundPSBT({
      draftB64: draft.psbt,
      boundB64: bound.psbt,
      prevTxHex: intent.prevTxHex,
      vout: String(intent.vout),
      recipientScript: intent.recipientScript,
      recipientAmount: String(intent.recipientAmount),
      fee: String(intent.fee),
      directSig,
      operationalScriptHex: pin.operationalScript,
      operationalAddress: pin.operationalAddress,
      network: live.network,
    })
    const kek = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO },
      await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    )
    phoneRoutineSecret = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(rec.nonce) }, kek, hexToBytes(rec.ciphertext)),
    )
    const signed = phoneRoutineSignPSBT(bound.psbt, phoneRoutineSecret)
    retry.stage(
      reviewKey,
      { psbt: signed, ...assertion },
      {
        submittedB64: signed,
        phoneRoutineBip340PubHex: rec.phoneRoutineBip340Pub,
        tweakedVaultCosignerXOnly: live.tweakedVaultCosignerXOnly,
        tweakedArkadeCosignerXOnly: live.tweakedArkadeCosignerXOnly,
      },
      challengeHex,
    )
    const out = await vaultPost<{ requestPsbt: string; signedPsbt: string; replay?: boolean }>('/v1/authorize', {
      vaultId,
      psbt: signed,
      ...assertion,
    })
    const requestB64 = validateServerRequest(signed, out.requestPsbt, challengeHex)
    const authorized = validateAuthorizedPSBT({
      submittedB64: requestB64,
      authorizedB64: out.signedPsbt,
      phoneRoutineBip340PubHex: rec.phoneRoutineBip340Pub,
      tweakedVaultCosignerXOnly: live.tweakedVaultCosignerXOnly,
      tweakedArkadeCosignerXOnly: live.tweakedArkadeCosignerXOnly,
    })
    retry.markAuthorized(reviewKey, {
      challengeHex,
      expectedTxid: authorized.transactionId,
      replay: out.replay === true,
    })
    const published = await vaultPost<{ txid: string }>('/v1/publish', { vaultId, challenge: challengeHex })
    if (published.txid !== authorized.transactionId) {
      throw new Error('published txid does not match the authorized transaction')
    }
    let followupTxid: string | undefined
    let followupError: string | undefined
    if (input.afterPublish) {
      try {
        followupTxid = (await input.afterPublish({ txid: published.txid, phoneRoutineSecret })) || undefined
      } catch (err) {
        followupError = err instanceof Error ? err.message : 'The follow-up operation did not finish'
      }
    }
    return { txid: published.txid, challenge: challengeHex, followupTxid, followupError }
  } finally {
    zeroBytes(prf, scalar, phoneRoutineSecret)
  }
}

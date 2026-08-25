import {
  ArkAddress,
  CSVMultisigTapscript,
  Intent,
  RestArkProvider,
  SingleKey,
  Transaction,
  type ArkProvider,
} from '@arkade-os/sdk'
import { base64, hex } from '@scure/base'
import { describe, expect, it, vi } from 'vitest'
import { POLICY_VERSION } from '../constants'
import { SAVINGS_TEMPLATE } from '../program/constants'
import type { VaultStatus } from '../types'
import golden from './testdata/vault-policy-v1-tree.json'
import {
  applyVtxoOperationView,
  advanceAuthorizedVtxoSpend,
  buildReservedVtxoSpend,
  buildPersistedVtxoSdkBundle,
  clearPersistedVtxoSpend,
  createVaultSdkOperationValidation,
  createVtxoOperationId,
  createPhoneSignedPendingProof,
  isVtxoReceiptPendingError,
  laterVtxoSpendStage,
  loadPersistedVtxoSpend,
  matchPendingOperatorSubmission,
  matchOperatorSignedCheckpoints,
  orderAuthorizedCheckpoints,
  isSameVtxoPayment,
  pendingVtxoSpendBlocksNewSend,
  persistVtxoSpend,
  persistVtxoReserveSignature,
  preReserveVtxoSpend,
  reconcilePersistedVtxoSpend,
  requireReviewedVtxoReservation,
  requireAuthorizedPendingProof,
  requireOperatorSignedCheckpoint,
  requireUserSignedArkInputs,
  VtxoReceiptPendingError,
  VtxoSpendInFlightError,
  VtxoReviewedReservationError,
  VtxoSpendUnresolvedError,
  VTXO_GET_PENDING_MESSAGE,
  type PersistedVtxoSpend,
  type VaultVtxoSpendQuote,
  type VtxoOperationView,
  type VtxoReserveResponse,
  vaultArkServer,
  vaultPolicyV1ScriptFromStatus,
  vtxoReserveRequest,
  sendVaultVtxo,
} from './spend'
import { arkadeIntentFeePolicyDigest } from './feePolicy'
import { VaultPolicyV1Script } from './script'
import type { SubmitExactVaultSdkOperationParams } from './sdkOperationAdapter'

const sdkOperationAdapterMocks = vi.hoisted(() => ({
  submit: vi.fn(),
}))

vi.mock('./sdkOperationAdapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sdkOperationAdapter')>()),
  submitExactVaultSdkOperation: sdkOperationAdapterMocks.submit,
}))

const TB1Q = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
const OP_1 = '11'.repeat(16)
const OP_2 = '22'.repeat(16)
const FEE_POLICY_DIGEST = 'aa'.repeat(32)
const RECONCILE_FEE_POLICY = {
  offchainInput: '5.0',
  offchainOutput: 'amount * 0.001',
  onchainInput: '7.0',
  onchainOutput: 'amount * 0.002',
} as const
const RESERVATION_FACTS = {
  feePolicyDigest: FEE_POLICY_DIGEST,
  feeSats: 500,
  changeSats: 7_500,
  changeVout: 1,
} as const

function compressed(xonly: string): string {
  return `02${xonly}`
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let index = 0; index <= haystack.length - needle.length; index++) {
    if (needle.every((byte, byteIndex) => byte === haystack[index + byteIndex])) return index
  }
  return -1
}

function status(): VaultStatus {
  const script = new VaultPolicyV1Script({
    userPub: hex.decode(golden.fixtures.userPub),
    vtxoVaultCosignerPub: hex.decode(golden.fixtures.vtxoVaultCosignerPub),
    arkdServerPub: hex.decode(golden.fixtures.arkdServerPub),
    delegatePub: hex.decode(golden.fixtures.delegatePub),
    exitDelay: 4608n,
    exitDelayUnit: 'seconds',
    exitDevicePub: hex.decode(golden.fixtures.userPub),
    exitHardwarePub: hex.decode(golden.fixtures.exitHardwarePub),
  })
  const address = new ArkAddress(hex.decode(golden.fixtures.arkdServerPub), script.tweakedPublicKey, 'tark')
  return {
    enrolled: true,
    network: 'mutinynet',
    clientOrigin: 'https://vault.test',
    rpId: 'vault.test',
    vaultId: 'vault-a',
    templateVersion: SAVINGS_TEMPLATE,
    policyVersion: POLICY_VERSION,
    savingsAddress: '',
    savingsScript: '',
    periodAllowance: 100_000,
    periodSpent: 0,
    periodRemaining: 100_000,
    txCap: 50_000,
    absoluteFeeCap: 1_500,
    feerateCapSatVb: 10,
    phoneBip340Pub: compressed(golden.fixtures.userPub),
    phoneDirectP256: compressed(golden.fixtures.exitDevicePub),
    externalOwnerWalletPub: compressed(golden.fixtures.exitHardwarePub),
    vtxoVaultCosignerPub: compressed(golden.fixtures.vtxoVaultCosignerPub),
    vtxoDelegatePub: compressed(golden.fixtures.delegatePub),
    vtxoExitDelay: 4608,
    vtxoExitDelayUnit: 'seconds',
    spendingArkAddress: address.encode(),
    spendingArkScript: hex.encode(script.pkScript),
  }
}

function reserve(): VtxoReserveResponse {
  const current = status()
  const unroll = CSVMultisigTapscript.encode({
    timelock: { type: 'seconds', value: 4096n },
    pubkeys: [hex.decode(golden.fixtures.arkdServerPub)],
  })
  return {
    operationId: OP_1,
    bundleDigest: '11'.repeat(32),
    reservationExpires: '2026-08-20T00:00:00Z',
    inputs: [{ txid: '22'.repeat(32), vout: 3, valueSats: 20_000, scriptHex: current.spendingArkScript! }],
    changeAddress: current.spendingArkAddress!,
    changeScript: current.spendingArkScript!,
    changeSats: 7_500,
    changeVout: 1,
    destScript: `5120${golden.fixtures.exitHardwarePub}`,
    feeSats: 500,
    feePolicyDigest: FEE_POLICY_DIGEST,
    checkpointTapscript: hex.encode(unroll.script),
  }
}

function fragmentedReserve(): VtxoReserveResponse {
  const current = reserve()
  current.inputs = [
    { ...current.inputs[0], txid: '11'.repeat(32), vout: 1, valueSats: 7_000 },
    { ...current.inputs[0], txid: '22'.repeat(32), vout: 3, valueSats: 13_000 },
  ]
  return current
}

function destination(): string {
  return new ArkAddress(
    hex.decode(golden.fixtures.arkdServerPub),
    hex.decode(golden.fixtures.exitHardwarePub),
    'tark',
  ).encode()
}

function reviewedPending(reservationExpires = '2099-08-20T00:02:00Z'): PersistedVtxoSpend {
  return {
    vaultId: 'vault-a',
    operationId: OP_1,
    bundleDigest: '11'.repeat(32),
    destAddress: destination(),
    amountSats: 12_000,
    arkTxid: 'aa'.repeat(32),
    reservationExpires,
    ...RESERVATION_FACTS,
    stage: 'reserved',
    unsignedArkPsbt: 'cHNidP9ark',
    unsignedCheckpointPsbts: ['cHNidP9cp'],
  }
}

function sdkReservedPending(): PersistedVtxoSpend {
  const current = status()
  const reservation = fragmentedReserve()
  const built = buildReservedVtxoSpend(current, reservation, 12_000, destination(), FEE_POLICY_DIGEST)
  return {
    vaultId: 'vault-a',
    operationId: OP_1,
    bundleDigest: '11'.repeat(32),
    destAddress: destination(),
    amountSats: 12_000,
    arkTxid: built.arkTx.id,
    reservationExpires: '2099-08-20T00:02:00Z',
    checkpointTapscript: reservation.checkpointTapscript,
    ...RESERVATION_FACTS,
    stage: 'reserved',
    unsignedArkPsbt: base64.encode(built.arkTx.toPSBT()),
    unsignedCheckpointPsbts: built.checkpoints.map((checkpoint) => base64.encode(checkpoint.toPSBT())),
    sdkBundleVersion: 1,
    reservedInputs: reservation.inputs.map((input) => ({ ...input })),
    reservedOutputs: [
      { scriptHex: reservation.destScript, amountSats: 12_000 },
      { scriptHex: reservation.changeScript, amountSats: reservation.changeSats },
    ],
  }
}

function reviewedQuote(pending = reviewedPending()): VaultVtxoSpendQuote {
  return {
    operationId: pending.operationId,
    bundleDigest: pending.bundleDigest,
    destAddress: pending.destAddress,
    amountSats: pending.amountSats,
    feeSats: pending.feeSats!,
    feePolicyDigest: pending.feePolicyDigest!,
    reservationExpires: pending.reservationExpires!,
    changeSats: pending.changeSats!,
    ...(pending.changeVout === undefined ? {} : { changeVout: pending.changeVout }),
  }
}

function reviewedOperation(pending = reviewedPending(), overrides: Partial<VtxoOperationView> = {}): VtxoOperationView {
  return {
    operationId: pending.operationId,
    bundleDigest: pending.bundleDigest,
    state: 'reserved',
    arkTxid: pending.arkTxid,
    expiresAt: pending.reservationExpires,
    feeSats: pending.feeSats,
    feePolicyDigest: pending.feePolicyDigest,
    changeSats: pending.changeSats,
    changeVout: pending.changeVout,
    ...overrides,
  }
}

function installImmediateNavigatorLock(): () => void {
  const original = navigator.locks
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) => callback({}),
    },
  })
  return () => {
    if (original) Object.defineProperty(navigator, 'locks', { configurable: true, value: original })
    else Reflect.deleteProperty(navigator, 'locks')
  }
}

function currentOperatorInfo(pending: PersistedVtxoSpend) {
  return {
    network: 'mutinynet',
    signerPubkey: golden.fixtures.arkdServerPub,
    checkpointTapscript: pending.checkpointTapscript,
    fees: { intentFee: RECONCILE_FEE_POLICY, txFeeRate: '0' },
  } as never
}

function freshPolicyPending(pending = sdkReservedPending()): PersistedVtxoSpend {
  return {
    ...pending,
    feePolicyDigest: arkadeIntentFeePolicyDigest(RECONCILE_FEE_POLICY),
  }
}

function validCheckpointPsbt(): string {
  const checkpoint = buildReservedVtxoSpend(status(), reserve(), 12_000, destination(), FEE_POLICY_DIGEST)
    .checkpoints[0]
  return base64.encode(checkpoint.toPSBT())
}

async function authorizedPendingFixture() {
  const current = status()
  const built = buildReservedVtxoSpend(current, fragmentedReserve(), 12_000, destination(), FEE_POLICY_DIGEST)
  const phone = SingleKey.fromPrivateKey(hex.decode('01'.padStart(64, '0')))
  const vault = SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0')))
  const operator = SingleKey.fromPrivateKey(hex.decode('04'.padStart(64, '0')))
  const unsignedCheckpointPsbts = built.checkpoints.map((checkpoint) => base64.encode(checkpoint.toPSBT()))
  const phoneProof = await createPhoneSignedPendingProof(
    unsignedCheckpointPsbts,
    phone,
    hex.decode(golden.fixtures.userPub),
  )
  const authorizedPendingProof = base64.encode(
    (await vault.sign(Transaction.fromPSBT(base64.decode(phoneProof)))).toPSBT(),
  )
  const phoneArk = await phone.sign(built.arkTx)
  const authorizedArk = await vault.sign(phoneArk)
  const finalArk = await operator.sign(authorizedArk)
  const operatorCheckpoints = await Promise.all(built.checkpoints.map((checkpoint) => operator.sign(checkpoint)))
  const pending: PersistedVtxoSpend = {
    vaultId: 'vault-a',
    operationId: OP_1,
    bundleDigest: '11'.repeat(32),
    destAddress: destination(),
    amountSats: 12_000,
    arkTxid: built.arkTx.id,
    ...RESERVATION_FACTS,
    stage: 'authorized',
    unsignedArkPsbt: base64.encode(phoneArk.toPSBT()),
    authorizedPsbt: base64.encode(authorizedArk.toPSBT()),
    authorizedPendingProof,
    unsignedCheckpointPsbts,
  }
  return {
    current,
    built,
    phone,
    vault,
    phoneArk,
    authorizedArk,
    finalArk,
    operatorCheckpoints,
    pending,
    phoneProof,
    authorizedPendingProof,
    operator,
    operatorPub: hex.decode(golden.fixtures.arkdServerPub),
    candidate: {
      arkTxid: built.arkTx.id,
      finalArkTx: base64.encode(finalArk.toPSBT()),
      signedCheckpointTxs: operatorCheckpoints.map((checkpoint) => base64.encode(checkpoint.toPSBT())),
    },
  }
}

describe('regular VTXO spend coordinator', () => {
  it('uses the same-origin Arkade gateway in production', () => {
    expect(vaultArkServer(true)).toBe('/arkade')
    expect(vaultArkServer(false)).toBe('https://mutinynet.arkade.sh')
  })

  it.each([
    ['operation id', { operationId: OP_2 }],
    ['bundle digest', { bundleDigest: '22'.repeat(32) }],
    ['authoritative fee', { feeSats: 501 }],
    ['fee policy', { feePolicyDigest: 'bb'.repeat(32) }],
    ['expiry', { expiresAt: '2099-08-20T00:03:00Z' }],
  ] as const)('rejects a reviewed reservation when the server changes its %s', (_label, changed) => {
    const pending = reviewedPending()
    expect(() =>
      requireReviewedVtxoReservation(pending, reviewedOperation(pending, changed), reviewedQuote(pending)),
    ).toThrow(VtxoReviewedReservationError)
  })

  it('rejects an aborted or expired reviewed reservation before approval', () => {
    const aborted = reviewedPending()
    expect(() =>
      requireReviewedVtxoReservation(aborted, reviewedOperation(aborted, { state: 'aborted' }), reviewedQuote(aborted)),
    ).toThrow(VtxoReviewedReservationError)

    const expired = reviewedPending('2026-08-20T00:02:00Z')
    expect(() =>
      requireReviewedVtxoReservation(
        expired,
        reviewedOperation(expired),
        reviewedQuote(expired),
        Date.parse('2026-08-20T00:02:01Z'),
      ),
    ).toThrow(VtxoReviewedReservationError)
  })

  it('allows the exact reviewed operation to resume after a lost authorization response', () => {
    const pending = reviewedPending('2026-08-20T00:02:00Z')
    expect(
      requireReviewedVtxoReservation(
        pending,
        reviewedOperation(pending, { state: 'signed' }),
        reviewedQuote(pending),
        Date.parse('2026-08-20T00:02:01Z'),
      ),
    ).toBe(pending)
  })

  it.each([
    [
      'aborted',
      (pending: PersistedVtxoSpend) =>
        new Response(JSON.stringify(reviewedOperation(pending, { state: 'aborted' })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ],
    [
      'expired',
      (pending: PersistedVtxoSpend) =>
        new Response(JSON.stringify(reviewedOperation(pending)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ],
    [
      'changed fee',
      (pending: PersistedVtxoSpend) =>
        new Response(JSON.stringify(reviewedOperation(pending, { feeSats: 501 })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ],
    [
      'missing operation',
      (pending: PersistedVtxoSpend) =>
        new Response(JSON.stringify({ error: pending.operationId ? 'operation not found' : 'invalid operation' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    ],
  ] as const)('does not reserve again or request a passkey for a %s review', async (kind, response) => {
    const pending = reviewedPending(kind === 'expired' ? '2020-08-20T00:02:00Z' : undefined)
    persistVtxoSpend(pending)
    const originalLocks = navigator.locks
    const originalCredentials = navigator.credentials
    const getCredential = vi.fn()
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) =>
          callback({}),
      },
    })
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { get: getCredential },
    })
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(pending))

    try {
      await expect(sendVaultVtxo({} as never, status(), reviewedQuote(pending))).rejects.toBeInstanceOf(
        VtxoReviewedReservationError,
      )
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(fetch.mock.calls[0][0]).toContain(`/v1/vtxo/operation?vaultId=vault-a&operationId=${OP_1}`)
      expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET' })
      expect(getCredential).not.toHaveBeenCalled()
    } finally {
      clearPersistedVtxoSpend('vault-a')
      if (originalLocks) {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: originalLocks })
      } else {
        Reflect.deleteProperty(navigator, 'locks')
      }
      if (originalCredentials) {
        Object.defineProperty(navigator, 'credentials', { configurable: true, value: originalCredentials })
      } else {
        Reflect.deleteProperty(navigator, 'credentials')
      }
    }
  })

  it('runs one fresh reserved v1 operation through the SDK adapter and clears it only after finalization', async () => {
    sdkOperationAdapterMocks.submit.mockReset()
    clearPersistedVtxoSpend('vault-a')
    const pending = freshPolicyPending()
    persistVtxoSpend(pending)
    const restoreLock = installImmediateNavigatorLock()
    const finalizeTx = vi.spyOn(RestArkProvider.prototype, 'finalizeTx').mockResolvedValue(undefined)
    vi.spyOn(RestArkProvider.prototype, 'getInfo').mockResolvedValue(currentOperatorInfo(pending))
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/v1/vtxo/operation')) {
        return new Response(JSON.stringify(reviewedOperation(pending)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/v1/vtxo/finalize')) {
        return new Response(
          JSON.stringify({
            operationId: pending.operationId,
            bundleDigest: pending.bundleDigest,
            state: 'finalized',
            arkTxid: pending.arkTxid,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new Error(`unexpected request: ${url}`)
    })
    sdkOperationAdapterMocks.submit.mockImplementation(async (params: SubmitExactVaultSdkOperationParams) => {
      expect(params.inputs.map(({ txid, vout, value }) => ({ txid, vout, value }))).toEqual(
        pending.reservedInputs!.map(({ txid, vout, valueSats }) => ({ txid, vout, value: valueSats })),
      )
      expect(params.outputs.map(({ script, amount }) => ({ script: hex.encode(script!), amount }))).toEqual(
        pending.reservedOutputs!.map(({ scriptHex, amountSats }) => ({
          script: scriptHex,
          amount: BigInt(amountSats),
        })),
      )
      await params.callbacks.finalize({
        arkTxid: pending.arkTxid,
        authorizedCheckpointPsbts: pending.unsignedCheckpointPsbts!,
        signal: new AbortController().signal,
      })
      return pending.arkTxid
    })

    try {
      await expect(sendVaultVtxo({} as never, status(), reviewedQuote(pending))).resolves.toEqual({
        txid: pending.arkTxid,
        operationId: pending.operationId,
        feeSats: pending.feeSats,
      })
      expect(sdkOperationAdapterMocks.submit).toHaveBeenCalledTimes(1)
      expect(finalizeTx).toHaveBeenCalledTimes(1)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(loadPersistedVtxoSpend('vault-a')).toBeUndefined()
    } finally {
      clearPersistedVtxoSpend('vault-a')
      restoreLock()
    }
  })

  it('requires the SDK callback bundle to be byte-identical to the persisted reservation before Face ID', async () => {
    sdkOperationAdapterMocks.submit.mockReset()
    clearPersistedVtxoSpend('vault-a')
    const pending = freshPolicyPending()
    persistVtxoSpend(pending)
    const restoreLock = installImmediateNavigatorLock()
    const originalCredentials = navigator.credentials
    const getCredential = vi.fn()
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { get: getCredential },
    })
    vi.spyOn(RestArkProvider.prototype, 'getInfo').mockResolvedValue(currentOperatorInfo(pending))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(reviewedOperation(pending)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    sdkOperationAdapterMocks.submit.mockImplementation(async (params: SubmitExactVaultSdkOperationParams) =>
      params.callbacks.authorizeArk({
        unsignedArkPsbt: `${pending.unsignedArkPsbt}A`,
        unsignedCheckpointPsbts: pending.unsignedCheckpointPsbts!,
        signal: new AbortController().signal,
      }),
    )

    try {
      await expect(sendVaultVtxo({} as never, status(), reviewedQuote(pending))).rejects.toThrow(
        /different reserved transaction bundle/,
      )
      expect(sdkOperationAdapterMocks.submit).toHaveBeenCalledTimes(1)
      expect(getCredential).not.toHaveBeenCalled()
      expect(loadPersistedVtxoSpend('vault-a')?.stage).toBe('reserved')
    } finally {
      clearPersistedVtxoSpend('vault-a')
      restoreLock()
      if (originalCredentials) {
        Object.defineProperty(navigator, 'credentials', { configurable: true, value: originalCredentials })
      } else {
        Reflect.deleteProperty(navigator, 'credentials')
      }
    }
  })

  it('resumes a lost fresh authorize response through the durable Operator path without rebuilding the spend', async () => {
    sdkOperationAdapterMocks.submit.mockReset()
    clearPersistedVtxoSpend('vault-a')
    const fixture = await authorizedPendingFixture()
    const pending = freshPolicyPending()
    persistVtxoSpend(pending)
    const restoreLock = installImmediateNavigatorLock()
    vi.spyOn(RestArkProvider.prototype, 'getInfo').mockResolvedValue(currentOperatorInfo(pending))
    const submit = vi.spyOn(RestArkProvider.prototype, 'submitTx').mockResolvedValue(fixture.candidate)
    const getPending = vi.spyOn(RestArkProvider.prototype, 'getPendingTxs')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify(
          reviewedOperation(pending, {
            state: 'signed',
            authorizedPsbt: fixture.pending.authorizedPsbt,
            authorizedPendingProof: fixture.pending.authorizedPendingProof,
          }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    try {
      await expect(sendVaultVtxo({} as never, fixture.current, reviewedQuote(pending))).rejects.toThrow(
        /deployment RP ID/,
      )
      expect(sdkOperationAdapterMocks.submit).not.toHaveBeenCalled()
      expect(submit).toHaveBeenCalledTimes(1)
      expect(getPending).not.toHaveBeenCalled()
      expect(loadPersistedVtxoSpend('vault-a')?.stage).toBe('operator-submitted')
    } finally {
      clearPersistedVtxoSpend('vault-a')
      restoreLock()
    }
  })

  it('resumes operator-submitted and checkpoints-authorized v1 records without entering the fresh adapter', async () => {
    sdkOperationAdapterMocks.submit.mockReset()
    clearPersistedVtxoSpend('vault-a')
    const fixture = await authorizedPendingFixture()
    const fresh = freshPolicyPending()
    const restoreLock = installImmediateNavigatorLock()
    vi.spyOn(RestArkProvider.prototype, 'getInfo').mockResolvedValue(currentOperatorInfo(fresh))
    const submit = vi.spyOn(RestArkProvider.prototype, 'submitTx')
    const getPending = vi.spyOn(RestArkProvider.prototype, 'getPendingTxs')
    const finalize = vi.spyOn(RestArkProvider.prototype, 'finalizeTx').mockRejectedValue(new Error('offline'))

    const operatorSubmitted: PersistedVtxoSpend = {
      ...fresh,
      stage: 'operator-submitted',
      unsignedArkPsbt: fixture.pending.unsignedArkPsbt,
      authorizedPsbt: fixture.pending.authorizedPsbt,
      authorizedPendingProof: fixture.pending.authorizedPendingProof,
      operatorArkPsbt: fixture.candidate.finalArkTx,
      operatorCheckpointPsbts: fixture.candidate.signedCheckpointTxs,
    }
    persistVtxoSpend(operatorSubmitted)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(reviewedOperation(operatorSubmitted, { state: 'signed' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    try {
      await expect(sendVaultVtxo({} as never, fixture.current, reviewedQuote(operatorSubmitted))).rejects.toThrow(
        /deployment RP ID/,
      )
      expect(sdkOperationAdapterMocks.submit).not.toHaveBeenCalled()
      expect(submit).not.toHaveBeenCalled()
      expect(getPending).not.toHaveBeenCalled()
      expect(loadPersistedVtxoSpend('vault-a')?.stage).toBe('operator-submitted')

      const checkpointPsbts: string[] = []
      for (const raw of fixture.candidate.signedCheckpointTxs) {
        const phoneSigned = await fixture.phone.sign(Transaction.fromPSBT(base64.decode(raw)))
        checkpointPsbts.push(base64.encode((await fixture.vault.sign(phoneSigned)).toPSBT()))
      }
      const checkpointsAuthorized: PersistedVtxoSpend = {
        ...operatorSubmitted,
        stage: 'checkpoints-authorized',
        checkpointPsbts,
      }
      persistVtxoSpend(checkpointsAuthorized)
      fetch.mockResolvedValue(
        new Response(JSON.stringify(reviewedOperation(checkpointsAuthorized, { state: 'submitted' })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

      await expect(sendVaultVtxo({} as never, fixture.current, reviewedQuote(checkpointsAuthorized))).rejects.toThrow(
        /offline/,
      )
      expect(sdkOperationAdapterMocks.submit).not.toHaveBeenCalled()
      expect(finalize).toHaveBeenCalledTimes(1)
      expect(loadPersistedVtxoSpend('vault-a')?.stage).toBe('checkpoints-authorized')
    } finally {
      clearPersistedVtxoSpend('vault-a')
      restoreLock()
    }
  })

  it('validates reloaded Vault signatures before any Operator submit or finalize', async () => {
    sdkOperationAdapterMocks.submit.mockReset()
    clearPersistedVtxoSpend('vault-a')
    const fixture = await authorizedPendingFixture()
    const operator = {
      submitTx: vi.fn(),
      getPendingTxs: vi.fn(),
    } as unknown as ArkProvider
    await expect(
      advanceAuthorizedVtxoSpend(
        operator,
        { ...fixture.pending, authorizedPsbt: base64.encode(fixture.phoneArk.toPSBT()) },
        fixture.current,
        fixture.operatorPub,
      ),
    ).rejects.toThrow(/wrong signer set/)
    expect(operator.submitTx).not.toHaveBeenCalled()
    expect(operator.getPendingTxs).not.toHaveBeenCalled()

    const fresh = freshPolicyPending()
    const checkpointOnlyOperator: PersistedVtxoSpend = {
      ...fresh,
      stage: 'checkpoints-authorized',
      authorizedPendingProof: fixture.pending.authorizedPendingProof,
      checkpointPsbts: fixture.candidate.signedCheckpointTxs,
    }
    persistVtxoSpend(checkpointOnlyOperator)
    const restoreLock = installImmediateNavigatorLock()
    vi.spyOn(RestArkProvider.prototype, 'getInfo').mockResolvedValue(currentOperatorInfo(fresh))
    const finalize = vi.spyOn(RestArkProvider.prototype, 'finalizeTx')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(reviewedOperation(checkpointOnlyOperator, { state: 'submitted' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    try {
      await expect(sendVaultVtxo({} as never, fixture.current, reviewedQuote(checkpointOnlyOperator))).rejects.toThrow(
        /wrong signer set/,
      )
      expect(finalize).not.toHaveBeenCalled()
      expect(sdkOperationAdapterMocks.submit).not.toHaveBeenCalled()
    } finally {
      clearPersistedVtxoSpend('vault-a')
      restoreLock()
    }
  })

  it('persists a client-generated operation id and signature before reserving and reuses them exactly', () => {
    clearPersistedVtxoSpend('vault-a')
    const operationId = createVtxoOperationId(hex.decode(OP_1))
    expect(operationId).toBe(OP_1)
    const pending = preReserveVtxoSpend('vault-a', destination(), 12_000, operationId)
    expect(loadPersistedVtxoSpend('vault-a')).toEqual(pending)
    const signed = persistVtxoReserveSignature(
      pending,
      status(),
      hex.decode('01'.padStart(64, '0')),
      new Uint8Array(32),
    )
    const firstRequest = vtxoReserveRequest(signed, status())
    expect(firstRequest).toEqual({
      vaultId: 'vault-a',
      operationId: OP_1,
      purpose: 'spend',
      destAddress: destination(),
      amountSats: 12_000,
      phoneSignature: signed.reservePhoneSignature,
    })
    expect(firstRequest.phoneSignature).toMatch(/^[0-9a-f]{128}$/)
    expect(vtxoReserveRequest(loadPersistedVtxoSpend('vault-a')!, status())).toEqual(firstRequest)
    clearPersistedVtxoSpend('vault-a')
  })

  it('keeps the pre-reserve record recoverable across unlock/sign and POST interruption', () => {
    clearPersistedVtxoSpend('vault-a')
    const pending = preReserveVtxoSpend('vault-a', destination(), 12_000, OP_1)
    expect(() =>
      persistVtxoReserveSignature(pending, status(), hex.decode('02'.padStart(64, '0')), new Uint8Array(32)),
    ).toThrow(/phone key/)
    expect(loadPersistedVtxoSpend('vault-a')).toEqual(pending)

    const signed = persistVtxoReserveSignature(
      pending,
      status(),
      hex.decode('01'.padStart(64, '0')),
      new Uint8Array(32),
    )
    const requestBeforeLostResponse = vtxoReserveRequest(signed, status())
    const recovered = loadPersistedVtxoSpend('vault-a')!
    expect(recovered).toEqual(signed)
    expect(vtxoReserveRequest(recovered, status())).toEqual(requestBeforeLostResponse)
    expect(() => vtxoReserveRequest({ ...recovered, amountSats: recovered.amountSats + 1 }, status())).toThrow(
      /device signature/,
    )
    clearPersistedVtxoSpend('vault-a')
  })

  it('keeps a pre-reservation until the same operation id is retried or aborted', () => {
    clearPersistedVtxoSpend('vault-a')
    const pending = preReserveVtxoSpend('vault-a', destination(), 12_000, OP_1)
    expect(
      applyVtxoOperationView(pending, {
        operationId: OP_1,
        bundleDigest: '11'.repeat(32),
        state: 'reserved',
      }),
    ).toEqual(pending)
    expect(loadPersistedVtxoSpend('vault-a')).toEqual(pending)
    expect(
      applyVtxoOperationView(pending, {
        operationId: OP_1,
        bundleDigest: '11'.repeat(32),
        state: 'aborted',
      }),
    ).toBeUndefined()
    expect(loadPersistedVtxoSpend('vault-a')).toBeUndefined()
  })

  it('reconstructs the pinned policy tree from status', () => {
    const current = status()
    expect(hex.encode(vaultPolicyV1ScriptFromStatus(current).pkScript)).toBe(current.spendingArkScript)
  })

  it('builds the SDK-native one-input checkpoint and Ark transaction', () => {
    const built = buildReservedVtxoSpend(status(), reserve(), 12_000, destination(), FEE_POLICY_DIGEST)
    expect(built.checkpoints).toHaveLength(1)
    expect(built.checkpoints[0].inputsLength).toBe(1)
    expect(built.checkpoints[0].outputsLength).toBe(2)
    expect(built.checkpoints[0].getInput(0).tapScriptSig).toBeUndefined()
    expect(built.arkTx.inputsLength).toBe(1)
    expect(built.arkTx.outputsLength).toBe(3)
    expect(built.arkTx.getOutput(0).amount).toBe(12_000n)
    expect(built.arkTx.getOutput(1).amount).toBe(7_500n)
  })

  it('preserves canonical fragmented inputs through checkpoints and Ark inputs', () => {
    const response = fragmentedReserve()
    const built = buildReservedVtxoSpend(status(), response, 12_000, destination(), FEE_POLICY_DIGEST)
    expect(built.checkpoints).toHaveLength(2)
    expect(built.arkTx.inputsLength).toBe(2)
    expect(built.arkTx.outputsLength).toBe(3)
    expect(response.inputs.map(({ txid, vout }) => `${txid}:${vout}`)).toEqual([
      `${'11'.repeat(32)}:1`,
      `${'22'.repeat(32)}:3`,
    ])
    expect(built.checkpoints.map((checkpoint) => hex.encode(checkpoint.getInput(0).txid!))).toEqual(
      response.inputs.map((input) => input.txid),
    )
    expect(built.arkTx.getOutput(0).amount).toBe(12_000n)
    expect(built.arkTx.getOutput(1).amount).toBe(7_500n)
  })

  it('uses the reserved zero fee when a payment needs more than the largest coin', () => {
    const response = fragmentedReserve()
    response.inputs[0].valueSats = 10_000
    response.inputs[1].valueSats = 25_000
    response.feeSats = 0
    response.changeSats = 5_000

    const built = buildReservedVtxoSpend(status(), response, 30_000, destination(), FEE_POLICY_DIGEST)
    expect(Math.max(...response.inputs.map((input) => input.valueSats))).toBeLessThan(30_000)
    expect(built.arkTx.getOutput(0).amount).toBe(30_000n)
    expect(built.arkTx.getOutput(1).amount).toBe(5_000n)

    response.feeSats = 1_500
    expect(() => buildReservedVtxoSpend(status(), response, 30_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /does not conserve value/,
    )
  })

  it('supports an exact spend with no change and P2A last', () => {
    const response = reserve()
    response.inputs[0].valueSats = 12_500
    response.changeSats = 0
    response.changeAddress = ''
    response.changeScript = ''
    delete response.changeVout
    const built = buildReservedVtxoSpend(status(), response, 12_000, destination(), FEE_POLICY_DIGEST)
    expect(built.arkTx.outputsLength).toBe(2)
    expect(built.arkTx.getOutput(0).amount).toBe(12_000n)
    expect(built.arkTx.getOutput(1).amount).toBe(0n)
  })

  it('rejects duplicate, shuffled, and malformed reservation inputs', () => {
    const duplicate = fragmentedReserve()
    duplicate.inputs[1] = { ...duplicate.inputs[0] }
    expect(() => buildReservedVtxoSpend(status(), duplicate, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /duplicate reserved input/,
    )

    const shuffled = fragmentedReserve()
    shuffled.inputs.reverse()
    expect(() => buildReservedVtxoSpend(status(), shuffled, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /not canonical/,
    )

    const malformed = fragmentedReserve()
    malformed.inputs[0].txid = 'AA'.repeat(32)
    expect(() => buildReservedVtxoSpend(status(), malformed, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /txid is malformed/,
    )
  })

  it('enforces authoritative fee, change shape, conservation, caps, and safe totals', () => {
    const wrongPolicy = reserve()
    expect(() => buildReservedVtxoSpend(status(), wrongPolicy, 12_000, destination(), 'bb'.repeat(32))).toThrow(
      /fee policy changed/,
    )

    const unconserved = reserve()
    unconserved.changeSats--
    expect(() => buildReservedVtxoSpend(status(), unconserved, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /does not conserve value/,
    )

    const excessiveFee = reserve()
    excessiveFee.feeSats = 1_501
    excessiveFee.changeSats = 6_499
    expect(() => buildReservedVtxoSpend(status(), excessiveFee, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /fee exceeds the vault cap/,
    )

    const subdust = reserve()
    subdust.inputs[0].valueSats = 12_600
    subdust.changeSats = 100
    expect(() => buildReservedVtxoSpend(status(), subdust, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /change is below dust/,
    )

    const mixedNoChange = reserve()
    mixedNoChange.inputs[0].valueSats = 12_500
    mixedNoChange.changeSats = 0
    expect(() => buildReservedVtxoSpend(status(), mixedNoChange, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /omit all change output facts/,
    )

    const missingChangeFacts = reserve()
    delete missingChangeFacts.changeVout
    expect(() =>
      buildReservedVtxoSpend(status(), missingChangeFacts, 12_000, destination(), FEE_POLICY_DIGEST),
    ).toThrow(/change output index is not canonical/)

    const overflow = fragmentedReserve()
    overflow.inputs[0].valueSats = Number.MAX_SAFE_INTEGER
    overflow.inputs[1].valueSats = Number.MAX_SAFE_INTEGER
    expect(() => buildReservedVtxoSpend(status(), overflow, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /overflows safe sats/,
    )

    const tooMany = reserve()
    tooMany.inputs = Array.from({ length: 51 }, (_, index) => ({
      ...tooMany.inputs[0],
      txid: index.toString(16).padStart(64, '0'),
      vout: 0,
      valueSats: 1,
    }))
    expect(() => buildReservedVtxoSpend(status(), tooMany, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /1 to 50 inputs/,
    )
  })

  it('signs every Ark input in a fragmented spend', async () => {
    const built = buildReservedVtxoSpend(status(), fragmentedReserve(), 12_000, destination(), FEE_POLICY_DIGEST)
    const user = SingleKey.fromPrivateKey(hex.decode('01'.padStart(64, '0')))
    const signed = await user.sign(built.arkTx)
    expect(() => requireUserSignedArkInputs(signed, hex.decode(golden.fixtures.userPub))).not.toThrow()
    expect(
      Array.from({ length: signed.inputsLength }, (_, index) => signed.getInput(index).tapScriptSig?.length),
    ).toEqual([1, 1])
  })

  it('matches shuffled Operator checkpoints by identity and restores canonical order', async () => {
    const built = buildReservedVtxoSpend(status(), fragmentedReserve(), 12_000, destination(), FEE_POLICY_DIGEST)
    const operator = SingleKey.fromPrivateKey(hex.decode('04'.padStart(64, '0')))
    const expected = built.checkpoints.map((checkpoint) => base64.encode(checkpoint.toPSBT()))
    const signed = await Promise.all(
      built.checkpoints.map(async (checkpoint) => base64.encode((await operator.sign(checkpoint)).toPSBT())),
    )
    const shuffled = [...signed].reverse()
    const ordered = matchOperatorSignedCheckpoints(expected, shuffled, hex.decode(golden.fixtures.arkdServerPub))
    expect(ordered.map((raw) => Transaction.fromPSBT(base64.decode(raw)).id)).toEqual(
      built.checkpoints.map((checkpoint) => checkpoint.id),
    )
    expect(
      orderAuthorizedCheckpoints(expected, shuffled).map((raw) => Transaction.fromPSBT(base64.decode(raw)).id),
    ).toEqual(built.checkpoints.map((checkpoint) => checkpoint.id))
    expect(() =>
      matchOperatorSignedCheckpoints(expected, signed.slice(0, 1), hex.decode(golden.fixtures.arkdServerPub)),
    ).toThrow(/wrong checkpoint count/)
    expect(() =>
      matchOperatorSignedCheckpoints(expected, [signed[0], signed[0]], hex.decode(golden.fixtures.arkdServerPub)),
    ).toThrow(/duplicate checkpoint/)
  })

  it('preserves the Operator checkpoint signature when the user signs after submit', async () => {
    const built = buildReservedVtxoSpend(status(), reserve(), 12_000, destination(), FEE_POLICY_DIGEST)
    // The frozen fixture's Arkade Operator key is private scalar 4.
    const operator = SingleKey.fromPrivateKey(hex.decode('04'.padStart(64, '0')))
    const user = SingleKey.fromPrivateKey(hex.decode('01'.padStart(64, '0')))
    const operatorSigned = await operator.sign(built.checkpoints[0])
    requireOperatorSignedCheckpoint(built.checkpoints[0], operatorSigned, hex.decode(golden.fixtures.arkdServerPub))
    const userAndOperatorSigned = await user.sign(operatorSigned)
    expect(userAndOperatorSigned.getInput(0).tapScriptSig?.map(([data]) => hex.encode(data.pubKey))).toEqual([
      golden.fixtures.arkdServerPub,
      golden.fixtures.userPub,
    ])
  })

  it('binds pending lookup to the exact checkpoints and requires phone plus VaultCosigner', async () => {
    const fixture = await authorizedPendingFixture()
    expect(
      requireAuthorizedPendingProof(
        fixture.pending.unsignedCheckpointPsbts!,
        fixture.authorizedPendingProof,
        fixture.current,
      ),
    ).toBe(fixture.authorizedPendingProof)
    expect(() =>
      requireAuthorizedPendingProof(fixture.pending.unsignedCheckpointPsbts!, fixture.phoneProof, fixture.current),
    ).toThrow(/wrong signer set/)

    const oversigned = base64.encode(
      (await fixture.operator.sign(Transaction.fromPSBT(base64.decode(fixture.authorizedPendingProof)))).toPSBT(),
    )
    expect(() =>
      requireAuthorizedPendingProof(fixture.pending.unsignedCheckpointPsbts!, oversigned, fixture.current),
    ).toThrow(/wrong signer set/)

    const missingSyntheticSignature = base64.encode(
      (
        await SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0'))).sign(
          Transaction.fromPSBT(base64.decode(fixture.phoneProof)),
          [1, 2],
        )
      ).toPSBT(),
    )
    expect(() =>
      requireAuthorizedPendingProof(
        fixture.pending.unsignedCheckpointPsbts!,
        missingSyntheticSignature,
        fixture.current,
      ),
    ).toThrow(/wrong signer set/)

    const authorizedProof = Transaction.fromPSBT(base64.decode(fixture.authorizedPendingProof))
    const signature = authorizedProof.getInput(0).tapScriptSig![0][1]
    const mutatedSyntheticSignature = base64.decode(fixture.authorizedPendingProof)
    const signatureOffset = indexOfBytes(mutatedSyntheticSignature, signature)
    expect(signatureOffset).toBeGreaterThanOrEqual(0)
    mutatedSyntheticSignature[signatureOffset + 10] ^= 1
    expect(() =>
      requireAuthorizedPendingProof(
        fixture.pending.unsignedCheckpointPsbts!,
        base64.encode(mutatedSyntheticSignature),
        fixture.current,
      ),
    ).toThrow()

    const message = new TextEncoder().encode(Intent.encodeMessage(VTXO_GET_PENDING_MESSAGE))
    const mutatedMessage = base64.decode(fixture.authorizedPendingProof)
    const messageOffset = indexOfBytes(mutatedMessage, message)
    expect(messageOffset).toBeGreaterThanOrEqual(0)
    mutatedMessage[messageOffset + message.length - 2] = '1'.charCodeAt(0)
    expect(() =>
      requireAuthorizedPendingProof(
        fixture.pending.unsignedCheckpointPsbts!,
        base64.encode(mutatedMessage),
        fixture.current,
      ),
    ).toThrow(/changed the pending proof PSBT/)

    const other = [...fixture.pending.unsignedCheckpointPsbts!]
    other[0] = validCheckpointPsbt()
    expect(() => requireAuthorizedPendingProof(other, fixture.authorizedPendingProof, fixture.current)).toThrow(
      /changed the pending proof/,
    )
  })

  it('accepts only the exact retained Ark transaction and Operator checkpoint bundle', async () => {
    const fixture = await authorizedPendingFixture()
    const matched = matchPendingOperatorSubmission(
      fixture.pending,
      [fixture.candidate],
      fixture.current,
      fixture.operatorPub,
    )
    expect(matched.arkTxid).toBe(fixture.pending.arkTxid)
    expect(Transaction.fromPSBT(base64.decode(matched.operatorArkPsbt)).id).toBe(fixture.pending.arkTxid)
    expect(matched.operatorCheckpointPsbts).toHaveLength(2)
    expect(() => matchPendingOperatorSubmission(fixture.pending, [], fixture.current, fixture.operatorPub)).toThrow(
      /exactly one/,
    )
    expect(() =>
      matchPendingOperatorSubmission(
        fixture.pending,
        [{ ...fixture.candidate, arkTxid: 'ff'.repeat(32) }],
        fixture.current,
        fixture.operatorPub,
      ),
    ).toThrow(/another transaction/)
    expect(() =>
      matchPendingOperatorSubmission(
        fixture.pending,
        [{ ...fixture.candidate, signedCheckpointTxs: fixture.candidate.signedCheckpointTxs.slice(0, 1) }],
        fixture.current,
        fixture.operatorPub,
      ),
    ).toThrow(/wrong checkpoint count/)
    expect(() =>
      matchPendingOperatorSubmission(
        fixture.pending,
        [{ ...fixture.candidate, finalArkTx: fixture.pending.authorizedPsbt! }],
        fixture.current,
        fixture.operatorPub,
      ),
    ).toThrow(/wrong signer set/)
  })

  it('requires the real signer sets and exact PSBTs at every SDK adapter stage', async () => {
    const fixture = await authorizedPendingFixture()
    const validation = createVaultSdkOperationValidation(fixture.current, fixture.built.arkTx, fixture.operatorPub)
    expect(() => validation.assertArkTransaction(fixture.built.arkTx, 'unsigned')).not.toThrow()
    expect(() => validation.assertArkTransaction(fixture.authorizedArk, 'vault-authorized')).not.toThrow()
    expect(() => validation.assertArkTransaction(fixture.finalArk, 'operator-signed')).not.toThrow()

    const originalCheckpoint = fixture.built.checkpoints[0]
    const operatorCheckpoint = fixture.operatorCheckpoints[0]
    expect(() =>
      validation.assertCheckpointTransaction(operatorCheckpoint, originalCheckpoint, 'operator-signed'),
    ).not.toThrow()
    expect(() =>
      validation.assertCheckpointTransaction(operatorCheckpoint, originalCheckpoint, 'vault-authorized'),
    ).toThrow(/wrong signer set/)

    const phoneCheckpoint = await fixture.phone.sign(operatorCheckpoint)
    const vaultCheckpoint = await fixture.vault.sign(phoneCheckpoint)
    expect(() =>
      validation.assertCheckpointTransaction(vaultCheckpoint, originalCheckpoint, 'vault-authorized'),
    ).not.toThrow()
  })

  it('submits once after reloading an authorized operation before the write-ahead marker', async () => {
    clearPersistedVtxoSpend('vault-a')
    const fixture = await authorizedPendingFixture()
    persistVtxoSpend(fixture.pending)
    const reloaded = loadPersistedVtxoSpend('vault-a')!
    const calls: string[] = []
    const operator = {
      async submitTx() {
        expect(loadPersistedVtxoSpend('vault-a')?.operatorSubmitAttempted).toBe(true)
        calls.push('submit')
        return fixture.candidate
      },
      async getPendingTxs() {
        calls.push('pending')
        return []
      },
    } as unknown as ArkProvider

    const submitted = await advanceAuthorizedVtxoSpend(operator, reloaded, fixture.current, fixture.operatorPub)
    expect(calls).toEqual(['submit'])
    expect(submitted.stage).toBe('operator-submitted')
    expect(submitted.operatorArkPsbt).toBe(fixture.candidate.finalArkTx)
    expect(loadPersistedVtxoSpend('vault-a')?.operatorArkPsbt).toBe(fixture.candidate.finalArkTx)
    clearPersistedVtxoSpend('vault-a')
  })

  it('recovers a lost submit response once through getPendingTxs without resubmitting', async () => {
    clearPersistedVtxoSpend('vault-a')
    const fixture = await authorizedPendingFixture()
    persistVtxoSpend(fixture.pending)
    const calls: string[] = []
    let recoveredProof = ''
    const operator = {
      async submitTx() {
        calls.push('submit')
        expect(loadPersistedVtxoSpend('vault-a')?.operatorSubmitAttempted).toBe(true)
        throw new TypeError('network response lost')
      },
      async getPendingTxs(intent: { proof: string; message: typeof VTXO_GET_PENDING_MESSAGE }) {
        calls.push('pending')
        recoveredProof = intent.proof
        expect(intent.message).toEqual(VTXO_GET_PENDING_MESSAGE)
        return [fixture.candidate]
      },
    } as unknown as ArkProvider

    const recovered = await advanceAuthorizedVtxoSpend(operator, fixture.pending, fixture.current, fixture.operatorPub)
    expect(calls).toEqual(['submit', 'pending'])
    expect(recoveredProof).toBe(fixture.authorizedPendingProof)
    expect(recovered.stage).toBe('operator-submitted')
    expect(recovered.operatorArkPsbt).toBe(fixture.candidate.finalArkTx)
    expect(loadPersistedVtxoSpend('vault-a')?.stage).toBe('operator-submitted')
    clearPersistedVtxoSpend('vault-a')
  })

  it('treats a reloaded write-ahead marker as ambiguous and uses lookup only', async () => {
    clearPersistedVtxoSpend('vault-a')
    const fixture = await authorizedPendingFixture()
    persistVtxoSpend({ ...fixture.pending, operatorSubmitAttempted: true })
    const reloaded = loadPersistedVtxoSpend('vault-a')!
    const calls: string[] = []
    const operator = {
      async submitTx() {
        calls.push('submit')
        throw new Error('must not submit')
      },
      async getPendingTxs() {
        calls.push('pending')
        return [fixture.candidate]
      },
    } as unknown as ArkProvider

    const recovered = await advanceAuthorizedVtxoSpend(operator, reloaded, fixture.current, fixture.operatorPub)
    expect(calls).toEqual(['pending'])
    expect(recovered.stage).toBe('operator-submitted')
    clearPersistedVtxoSpend('vault-a')
  })

  it('keeps an attempted operation locked when pending lookup is empty', async () => {
    clearPersistedVtxoSpend('vault-a')
    const fixture = await authorizedPendingFixture()
    persistVtxoSpend({ ...fixture.pending, operatorSubmitAttempted: true })
    const reloaded = loadPersistedVtxoSpend('vault-a')!
    let submitCalls = 0
    let pendingCalls = 0
    const operator = {
      async submitTx() {
        submitCalls++
        throw new Error('must not submit')
      },
      async getPendingTxs() {
        pendingCalls++
        return []
      },
    } as unknown as ArkProvider

    await expect(advanceAuthorizedVtxoSpend(operator, reloaded, fixture.current, fixture.operatorPub)).rejects.toThrow(
      /exactly one/,
    )
    expect(submitCalls).toBe(0)
    expect(pendingCalls).toBe(1)
    expect(loadPersistedVtxoSpend('vault-a')?.stage).toBe('authorized')
    expect(loadPersistedVtxoSpend('vault-a')?.operatorSubmitAttempted).toBe(true)

    const legacy = { ...fixture.pending, authorizedPendingProof: undefined }
    await expect(
      advanceAuthorizedVtxoSpend(operator, legacy, fixture.current, fixture.operatorPub),
    ).rejects.toBeInstanceOf(VtxoSpendInFlightError)
    expect(submitCalls).toBe(0)
    clearPersistedVtxoSpend('vault-a')
  })

  it.each([
    ['unattempted', false, 1, 0],
    ['attempted', true, 0, 1],
  ] as const)(
    'reconciles a persisted authorized %s operation using the durable submit marker',
    async (_label, attempted, expectedSubmitCalls, expectedPendingCalls) => {
      clearPersistedVtxoSpend('vault-a')
      const fixture = await authorizedPendingFixture()
      const pending = {
        ...fixture.pending,
        feePolicyDigest: arkadeIntentFeePolicyDigest(RECONCILE_FEE_POLICY),
        ...(attempted ? { operatorSubmitAttempted: true } : {}),
      }
      persistVtxoSpend(pending)
      const originalLocks = navigator.locks
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
          request: async (_name: string, _options: unknown, callback: (lock: unknown) => Promise<unknown>) =>
            callback({}),
        },
      })
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            operationId: pending.operationId,
            bundleDigest: pending.bundleDigest,
            state: 'signed',
            arkTxid: pending.arkTxid,
            authorizedPsbt: pending.authorizedPsbt,
            authorizedPendingProof: pending.authorizedPendingProof,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      vi.spyOn(RestArkProvider.prototype, 'getInfo').mockResolvedValue({
        network: 'mutinynet',
        signerPubkey: golden.fixtures.arkdServerPub,
        checkpointTapscript: '',
        fees: { intentFee: RECONCILE_FEE_POLICY, txFeeRate: '0' },
      } as never)
      const submit = vi.spyOn(RestArkProvider.prototype, 'submitTx').mockImplementation(async () => {
        expect(loadPersistedVtxoSpend('vault-a')?.operatorSubmitAttempted).toBe(true)
        return fixture.candidate
      })
      const getPending = vi.spyOn(RestArkProvider.prototype, 'getPendingTxs').mockResolvedValue([fixture.candidate])

      try {
        await expect(reconcilePersistedVtxoSpend(fixture.current)).resolves.toEqual({
          kind: 'pending',
          operationId: pending.operationId,
          stage: 'operator-submitted',
        })
        expect(submit).toHaveBeenCalledTimes(expectedSubmitCalls)
        expect(getPending).toHaveBeenCalledTimes(expectedPendingCalls)
        expect(loadPersistedVtxoSpend('vault-a')?.stage).toBe('operator-submitted')
      } finally {
        clearPersistedVtxoSpend('vault-a')
        if (originalLocks) {
          Object.defineProperty(navigator, 'locks', { configurable: true, value: originalLocks })
        } else {
          Reflect.deleteProperty(navigator, 'locks')
        }
      }
    },
  )

  it('fails closed if status and reservation do not name the same policy script', () => {
    const changed = reserve()
    changed.changeScript = `5120${'44'.repeat(32)}`
    expect(() => buildReservedVtxoSpend(status(), changed, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /change is not vault-policy-v1/,
    )
  })

  it('rejects a reservation for another destination or Operator', () => {
    const changed = reserve()
    changed.destScript = `5120${golden.fixtures.delegatePub}`
    expect(() => buildReservedVtxoSpend(status(), changed, 12_000, destination(), FEE_POLICY_DIGEST)).toThrow(
      /reserved destination/,
    )
    const otherOperator = new ArkAddress(
      hex.decode(golden.fixtures.userPub),
      hex.decode(golden.fixtures.exitHardwarePub),
      'tark',
    ).encode()
    expect(() => buildReservedVtxoSpend(status(), reserve(), 12_000, otherOperator, FEE_POLICY_DIGEST)).toThrow(
      /another Arkade Operator/,
    )
  })

  it('keeps Bitcoin destinations on the onchain spend path', () => {
    expect(() => buildReservedVtxoSpend(status(), reserve(), 12_000, TB1Q, FEE_POLICY_DIGEST)).toThrow(
      /VTXO destination must be an Arkade address/,
    )
  })

  it('does not treat an older persisted spend as the newly approved payment', () => {
    clearPersistedVtxoSpend('vault-a')
    persistVtxoSpend({
      vaultId: 'vault-a',
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      destAddress: 'tark1qqold',
      amountSats: 12_000,
      arkTxid: 'aa'.repeat(32),
      ...RESERVATION_FACTS,
      stage: 'operator-finalized',
    })
    const pending = loadPersistedVtxoSpend('vault-a')
    expect(pendingVtxoSpendBlocksNewSend(pending)).toBe(true)
    expect(isSameVtxoPayment(pending!, 'tark1qqold', 12_000)).toBe(true)
    expect(isSameVtxoPayment(pending!, 'tark1qqnew', 12_000)).toBe(false)
    expect(isVtxoReceiptPendingError(new VtxoReceiptPendingError('aa'.repeat(32), OP_1, 0))).toBe(true)
    expect(new VtxoSpendInFlightError('aa'.repeat(32), OP_1).message).toMatch(/still with the operator/)
    clearPersistedVtxoSpend('vault-a')
    expect(pendingVtxoSpendBlocksNewSend(loadPersistedVtxoSpend('vault-a'))).toBe(false)
  })

  it('persists the reservation and PSBT material before authorization', () => {
    clearPersistedVtxoSpend('vault-a')
    const reserved: PersistedVtxoSpend = {
      vaultId: 'vault-a',
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      destAddress: destination(),
      amountSats: 12_000,
      arkTxid: 'aa'.repeat(32),
      reservationExpires: '2026-08-20T00:02:00Z',
      ...RESERVATION_FACTS,
      stage: 'reserved',
      unsignedArkPsbt: 'cHNidP9ark',
      unsignedCheckpointPsbts: ['cHNidP9cp'],
    }
    persistVtxoSpend(reserved)
    expect(loadPersistedVtxoSpend('vault-a')).toMatchObject(reserved)
    expect(pendingVtxoSpendBlocksNewSend(loadPersistedVtxoSpend('vault-a'))).toBe(true)
    clearPersistedVtxoSpend('vault-a')
  })

  it('persists and deterministically rebuilds the validated fresh SDK bundle', () => {
    clearPersistedVtxoSpend('vault-a')
    const reserved = sdkReservedPending()
    persistVtxoSpend(reserved)

    const reloaded = loadPersistedVtxoSpend('vault-a')!
    expect(reloaded).toMatchObject({
      sdkBundleVersion: 1,
      reservedInputs: reserved.reservedInputs,
      reservedOutputs: reserved.reservedOutputs,
    })
    const rebuilt = buildPersistedVtxoSdkBundle(status(), reloaded)
    expect(rebuilt.rebuilt.arkTx.id).toBe(reserved.arkTxid)
    expect(rebuilt.rebuilt.checkpoints.map((tx) => tx.id)).toEqual(
      reserved.unsignedCheckpointPsbts!.map((raw) => Transaction.fromPSBT(base64.decode(raw)).id),
    )
    clearPersistedVtxoSpend('vault-a')
  })

  it.each([
    [
      'too many inputs',
      (pending: PersistedVtxoSpend) => ({
        ...pending,
        reservedInputs: Array.from({ length: 51 }, (_, index) => ({
          ...pending.reservedInputs![0],
          txid: index.toString(16).padStart(64, '0'),
        })),
      }),
    ],
    [
      'noncanonical inputs',
      (pending: PersistedVtxoSpend) => ({ ...pending, reservedInputs: [...pending.reservedInputs!].reverse() }),
    ],
    [
      'missing change output',
      (pending: PersistedVtxoSpend) => ({ ...pending, reservedOutputs: pending.reservedOutputs!.slice(0, 1) }),
    ],
    [
      'reordered outputs',
      (pending: PersistedVtxoSpend) => ({ ...pending, reservedOutputs: [...pending.reservedOutputs!].reverse() }),
    ],
    [
      'malformed script',
      (pending: PersistedVtxoSpend) => ({
        ...pending,
        reservedInputs: [{ ...pending.reservedInputs![0], scriptHex: '00' }, ...pending.reservedInputs!.slice(1)],
      }),
    ],
  ] as const)('rejects a persisted fresh SDK bundle with %s', (_label, mutate) => {
    clearPersistedVtxoSpend('vault-a')
    persistVtxoSpend(mutate(sdkReservedPending()))
    expect(loadPersistedVtxoSpend('vault-a')).toBeUndefined()
    clearPersistedVtxoSpend('vault-a')
  })

  it('revalidates stored SDK scripts against the current pinned Vault policy', () => {
    const pending = sdkReservedPending()
    pending.reservedInputs = pending.reservedInputs!.map((input) => ({ ...input, scriptHex: `5120${'44'.repeat(32)}` }))
    expect(() => buildPersistedVtxoSdkBundle(status(), pending)).toThrow(/not current vault-policy-v1/)
  })

  it.each([
    ['reserved', (pending: PersistedVtxoSpend) => pending],
    [
      'authorized',
      (pending: PersistedVtxoSpend) => ({
        ...pending,
        stage: 'authorized' as const,
        authorizedPsbt: pending.unsignedArkPsbt,
        authorizedPendingProof: pending.unsignedCheckpointPsbts![0],
      }),
    ],
    [
      'operator-submitted',
      (pending: PersistedVtxoSpend) => ({
        ...pending,
        stage: 'operator-submitted' as const,
        authorizedPsbt: pending.unsignedArkPsbt,
        authorizedPendingProof: pending.unsignedCheckpointPsbts![0],
        operatorSubmitAttempted: true,
        operatorArkPsbt: pending.unsignedArkPsbt,
        operatorCheckpointPsbts: pending.unsignedCheckpointPsbts,
      }),
    ],
    [
      'checkpoints-authorized',
      (pending: PersistedVtxoSpend) => ({
        ...pending,
        stage: 'checkpoints-authorized' as const,
        authorizedPendingProof: pending.unsignedCheckpointPsbts![0],
        checkpointPsbts: pending.unsignedCheckpointPsbts,
      }),
    ],
    [
      'operator-finalized',
      (pending: PersistedVtxoSpend) => ({
        ...pending,
        stage: 'operator-finalized' as const,
        authorizedPendingProof: pending.unsignedCheckpointPsbts![0],
        checkpointPsbts: pending.unsignedCheckpointPsbts,
      }),
    ],
  ] as const)('reloads a fresh SDK operation at the durable %s boundary', (stage, atBoundary) => {
    clearPersistedVtxoSpend('vault-a')
    const pending = atBoundary(sdkReservedPending())
    persistVtxoSpend(pending)
    expect(loadPersistedVtxoSpend('vault-a')).toMatchObject({
      stage,
      sdkBundleVersion: 1,
      reservedInputs: pending.reservedInputs,
      reservedOutputs: pending.reservedOutputs,
    })
    clearPersistedVtxoSpend('vault-a')
  })

  it('uses the operation view to resume a lost authorize response', () => {
    clearPersistedVtxoSpend('vault-a')
    const checkpointPsbt = validCheckpointPsbt()
    const reserved: PersistedVtxoSpend = {
      vaultId: 'vault-a',
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      destAddress: destination(),
      amountSats: 12_000,
      arkTxid: 'aa'.repeat(32),
      ...RESERVATION_FACTS,
      stage: 'reserved',
      unsignedArkPsbt: 'cHNidP9ark',
      unsignedCheckpointPsbts: [checkpointPsbt],
    }
    persistVtxoSpend(reserved)
    const signed = applyVtxoOperationView(reserved, {
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      state: 'signed',
      arkTxid: 'aa'.repeat(32),
      authorizedPsbt: 'cHNidP9signed',
      authorizedPendingProof: 'cHNidP9pending',
    })
    expect(signed?.stage).toBe('authorized')
    expect(signed?.authorizedPsbt).toBe('cHNidP9signed')
    expect(signed?.authorizedPendingProof).toBe('cHNidP9pending')
    expect(loadPersistedVtxoSpend('vault-a')?.stage).toBe('authorized')

    const submitted = applyVtxoOperationView(signed!, {
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      state: 'submitted',
      arkTxid: 'aa'.repeat(32),
      authorizedPsbt: 'cHNidP9signed',
      checkpointPsbts: [checkpointPsbt],
    })
    expect(submitted?.stage).toBe('checkpoints-authorized')
    expect(submitted?.checkpointPsbts).toEqual([checkpointPsbt])

    const finalized = applyVtxoOperationView(submitted!, {
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      state: 'finalized',
      arkTxid: 'aa'.repeat(32),
    })
    expect(finalized?.stage).toBe('operator-finalized')

    expect(
      applyVtxoOperationView(finalized!, {
        operationId: OP_1,
        bundleDigest: '11'.repeat(32),
        state: 'aborted',
      }),
    ).toBeUndefined()
    expect(loadPersistedVtxoSpend('vault-a')).toBeUndefined()
  })

  it('fails closed on an unresolved operation', () => {
    const pending: PersistedVtxoSpend = {
      vaultId: 'vault-a',
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      destAddress: destination(),
      amountSats: 12_000,
      arkTxid: 'aa'.repeat(32),
      ...RESERVATION_FACTS,
      stage: 'authorized',
      authorizedPsbt: 'cHNidP9signed',
      unsignedCheckpointPsbts: ['cHNidP9cp'],
    }
    expect(() =>
      applyVtxoOperationView(pending, {
        operationId: OP_1,
        bundleDigest: '11'.repeat(32),
        state: 'unresolved',
        arkTxid: 'aa'.repeat(32),
      }),
    ).toThrow(VtxoSpendUnresolvedError)
  })

  it('merges operation status without moving the local stage backward', () => {
    expect(laterVtxoSpendStage('operator-submitted', 'authorized')).toBe('operator-submitted')
    expect(laterVtxoSpendStage('operator-finalized', 'checkpoints-authorized')).toBe('operator-finalized')
    expect(laterVtxoSpendStage('reserved', 'authorized')).toBe('authorized')

    clearPersistedVtxoSpend('vault-a')
    const checkpointPsbt = validCheckpointPsbt()
    const submitted: PersistedVtxoSpend = {
      vaultId: 'vault-a',
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      destAddress: destination(),
      amountSats: 12_000,
      arkTxid: 'aa'.repeat(32),
      ...RESERVATION_FACTS,
      stage: 'operator-submitted',
      authorizedPsbt: 'cHNidP9local',
      unsignedCheckpointPsbts: [checkpointPsbt],
      operatorCheckpointPsbts: ['cHNidP9op'],
    }
    const afterSigned = applyVtxoOperationView(submitted, {
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      state: 'signed',
      arkTxid: 'aa'.repeat(32),
      authorizedPsbt: 'cHNidP9signed',
    })
    expect(afterSigned?.stage).toBe('operator-submitted')
    expect(afterSigned?.authorizedPsbt).toBe('cHNidP9signed')
    expect(afterSigned?.operatorCheckpointPsbts).toEqual(['cHNidP9op'])

    const finalized: PersistedVtxoSpend = {
      ...submitted,
      stage: 'operator-finalized',
      checkpointPsbts: [checkpointPsbt],
    }
    const afterSubmitted = applyVtxoOperationView(finalized, {
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      state: 'submitted',
      arkTxid: 'aa'.repeat(32),
      authorizedPsbt: 'cHNidP9signed',
      checkpointPsbts: [checkpointPsbt],
    })
    expect(afterSubmitted?.stage).toBe('operator-finalized')
    expect(afterSubmitted?.checkpointPsbts).toEqual([checkpointPsbt])
    clearPersistedVtxoSpend('vault-a')
  })

  it('rejects an operation view for a different id or digest', () => {
    const pending: PersistedVtxoSpend = {
      vaultId: 'vault-a',
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      destAddress: destination(),
      amountSats: 12_000,
      arkTxid: 'aa'.repeat(32),
      ...RESERVATION_FACTS,
      stage: 'authorized',
      authorizedPsbt: 'cHNidP9signed',
    }
    expect(() =>
      applyVtxoOperationView(pending, {
        operationId: OP_2,
        bundleDigest: '11'.repeat(32),
        state: 'signed',
      }),
    ).toThrow(/operation id mismatch/)
    expect(() =>
      applyVtxoOperationView(pending, {
        operationId: OP_1,
        bundleDigest: '22'.repeat(32),
        state: 'signed',
      }),
    ).toThrow(/digest mismatch/)
  })
})

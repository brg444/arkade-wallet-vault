import { ArkAddress, CSVMultisigTapscript, SingleKey, Transaction } from '@arkade-os/sdk'
import { base64, hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { POLICY_VERSION } from '../constants'
import { SAVINGS_TEMPLATE } from '../program/constants'
import type { VaultStatus } from '../types'
import golden from './testdata/vault-policy-v1-tree.json'
import {
  applyVtxoOperationView,
  buildReservedVtxoSpend,
  clearPersistedVtxoSpend,
  collectPagedVtxos,
  createVtxoOperationId,
  isVtxoReceiptPendingError,
  laterVtxoSpendStage,
  loadPersistedVtxoSpend,
  matchOperatorSignedCheckpoints,
  orderAuthorizedCheckpoints,
  isSameVtxoPayment,
  pendingVtxoSpendBlocksNewSend,
  persistVtxoSpend,
  persistVtxoReserveSignature,
  preReserveVtxoSpend,
  requireMatchingOperatorSubmit,
  requireOperatorSignedCheckpoint,
  requireUserSignedArkInputs,
  VtxoReceiptPendingError,
  VtxoSpendInFlightError,
  VtxoSpendUnresolvedError,
  type PersistedVtxoSpend,
  type VtxoReserveResponse,
  vaultArkServer,
  vaultPolicyV1ScriptFromStatus,
  vtxoReserveRequest,
} from './spend'
import { VaultPolicyV1Script } from './script'

const TB1Q = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
const OP_1 = '11'.repeat(16)
const OP_2 = '22'.repeat(16)
const FEE_POLICY_DIGEST = 'aa'.repeat(32)
const RESERVATION_FACTS = {
  feePolicyDigest: FEE_POLICY_DIGEST,
  feeSats: 500,
  changeSats: 7_500,
  changeVout: 1,
} as const

function compressed(xonly: string): string {
  return `02${xonly}`
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

function validCheckpointPsbt(): string {
  const checkpoint = buildReservedVtxoSpend(status(), reserve(), 12_000, destination(), FEE_POLICY_DIGEST)
    .checkpoints[0]
  return base64.encode(checkpoint.toPSBT())
}

describe('regular VTXO spend coordinator', () => {
  it('uses the same-origin Arkade gateway in production', () => {
    expect(vaultArkServer(true)).toBe('/arkade')
    expect(vaultArkServer(false)).toBe('https://mutinynet.arkade.sh')
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
    expect(isVtxoReceiptPendingError(new VtxoReceiptPendingError('aa'.repeat(32), OP_1))).toBe(true)
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
    })
    expect(signed?.stage).toBe('authorized')
    expect(signed?.authorizedPsbt).toBe('cHNidP9signed')
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

  it('fetches every indexer page before classifying history', async () => {
    const pages = [
      { vtxos: [{ txid: 'input' }], page: { current: 0, next: 1, total: 2 } },
      { vtxos: [{ txid: 'change' }], page: { current: 1, next: 2, total: 2 } },
    ]
    const requested: number[] = []
    const vtxos = await collectPagedVtxos(async (pageIndex) => {
      requested.push(pageIndex)
      return pages[pageIndex]
    })
    expect(requested).toEqual([0, 1])
    expect(vtxos.map((vtxo) => vtxo.txid)).toEqual(['input', 'change'])
  })

  it('rejects a resumed Operator submission that changed the Ark transaction', () => {
    expect(() =>
      requireMatchingOperatorSubmit({ arkTxid: 'bb'.repeat(32), signedCheckpointTxs: ['cHNidP9'] }, 'aa'.repeat(32), 1),
    ).toThrow(/Operator submission does not match/)
    expect(() =>
      requireMatchingOperatorSubmit({ arkTxid: 'aa'.repeat(32), signedCheckpointTxs: [] }, 'aa'.repeat(32), 1),
    ).toThrow(/Operator submission does not match/)
    expect(() =>
      requireMatchingOperatorSubmit({ arkTxid: 'aa'.repeat(32), signedCheckpointTxs: ['cHNidP9'] }, 'aa'.repeat(32), 1),
    ).not.toThrow()
  })
})

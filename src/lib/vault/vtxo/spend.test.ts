import { ArkAddress, CSVMultisigTapscript, SingleKey } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
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
  isSameVtxoPayment,
  pendingVtxoSpendBlocksNewSend,
  persistVtxoSpend,
  preReserveVtxoSpend,
  requireMatchingOperatorSubmit,
  requireOperatorSignedCheckpoint,
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
    templateVersion: 'phone-hww-recovery-staged-v6',
    policyVersion: 'operational-vault-v1',
    operationalCsvBlocks: 12,
    savingsCsvBlocks: 144,
    operationalAddress: '',
    savingsAddress: '',
    savingsExcludesRoutineCosigners: true,
    periodAllowance: 100_000,
    periodSpent: 0,
    periodRemaining: 100_000,
    txCap: 50_000,
    absoluteFeeCap: 1_500,
    feerateCapSatVb: 10,
    phoneRoutineBip340Pub: compressed(golden.fixtures.userPub),
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
    destScript: `5120${golden.fixtures.exitHardwarePub}`,
    feeSats: 0,
    checkpointTapscript: hex.encode(unroll.script),
  }
}

function destination(): string {
  return new ArkAddress(
    hex.decode(golden.fixtures.arkdServerPub),
    hex.decode(golden.fixtures.exitHardwarePub),
    'tark',
  ).encode()
}

describe('regular VTXO spend coordinator', () => {
  it('uses the same-origin Arkade gateway in production', () => {
    expect(vaultArkServer(true)).toBe('/arkade')
    expect(vaultArkServer(false)).toBe('https://mutinynet.arkade.sh')
  })

  it('persists a client-generated operation id before reserving and reuses it exactly', () => {
    clearPersistedVtxoSpend('vault-a')
    const operationId = createVtxoOperationId(hex.decode(OP_1))
    expect(operationId).toBe(OP_1)
    const pending = preReserveVtxoSpend('vault-a', destination(), 12_000, operationId)
    expect(loadPersistedVtxoSpend('vault-a')).toEqual(pending)
    expect(vtxoReserveRequest(loadPersistedVtxoSpend('vault-a')!)).toEqual({
      vaultId: 'vault-a',
      operationId: OP_1,
      purpose: 'spend',
      destAddress: destination(),
      amountSats: 12_000,
    })
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
    const built = buildReservedVtxoSpend(status(), reserve(), 12_000, destination())
    expect(built.checkpoints).toHaveLength(1)
    expect(built.checkpoints[0].inputsLength).toBe(1)
    expect(built.checkpoints[0].outputsLength).toBe(2)
    expect(built.checkpoints[0].getInput(0).tapScriptSig).toBeUndefined()
    expect(built.arkTx.inputsLength).toBe(1)
    expect(built.arkTx.outputsLength).toBe(3)
    expect(built.arkTx.getOutput(0).amount).toBe(12_000n)
    expect(built.arkTx.getOutput(1).amount).toBe(8_000n)
  })

  it('preserves the Operator checkpoint signature when the user signs after submit', async () => {
    const built = buildReservedVtxoSpend(status(), reserve(), 12_000, destination())
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
    expect(() => buildReservedVtxoSpend(status(), changed, 12_000, destination())).toThrow(
      /change is not vault-policy-v1/,
    )
  })

  it('rejects a reservation for another destination or Operator', () => {
    const changed = reserve()
    changed.destScript = `5120${golden.fixtures.delegatePub}`
    expect(() => buildReservedVtxoSpend(status(), changed, 12_000, destination())).toThrow(/reserved destination/)
    const otherOperator = new ArkAddress(
      hex.decode(golden.fixtures.userPub),
      hex.decode(golden.fixtures.exitHardwarePub),
      'tark',
    ).encode()
    expect(() => buildReservedVtxoSpend(status(), reserve(), 12_000, otherOperator)).toThrow(/another Arkade Operator/)
  })

  it('keeps Bitcoin destinations on the onchain spend path', () => {
    expect(() => buildReservedVtxoSpend(status(), reserve(), 12_000, TB1Q)).toThrow(
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
    const reserved: PersistedVtxoSpend = {
      vaultId: 'vault-a',
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      destAddress: destination(),
      amountSats: 12_000,
      arkTxid: 'aa'.repeat(32),
      stage: 'reserved',
      unsignedArkPsbt: 'cHNidP9ark',
      unsignedCheckpointPsbts: ['cHNidP9cp'],
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
      checkpointPsbts: ['cHNidP9final'],
    })
    expect(submitted?.stage).toBe('checkpoints-authorized')
    expect(submitted?.checkpointPsbts).toEqual(['cHNidP9final'])

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
    const submitted: PersistedVtxoSpend = {
      vaultId: 'vault-a',
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      destAddress: destination(),
      amountSats: 12_000,
      arkTxid: 'aa'.repeat(32),
      stage: 'operator-submitted',
      authorizedPsbt: 'cHNidP9local',
      unsignedCheckpointPsbts: ['cHNidP9cp'],
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
      checkpointPsbts: ['cHNidP9local-final'],
    }
    const afterSubmitted = applyVtxoOperationView(finalized, {
      operationId: OP_1,
      bundleDigest: '11'.repeat(32),
      state: 'submitted',
      arkTxid: 'aa'.repeat(32),
      authorizedPsbt: 'cHNidP9signed',
      checkpointPsbts: ['cHNidP9final'],
    })
    expect(afterSubmitted?.stage).toBe('operator-finalized')
    expect(afterSubmitted?.checkpointPsbts).toEqual(['cHNidP9final'])
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

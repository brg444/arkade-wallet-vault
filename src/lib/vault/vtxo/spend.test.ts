import { ArkAddress, CSVMultisigTapscript, SingleKey } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import type { VaultStatus } from '../types'
import golden from './testdata/vault-policy-v1-tree.json'
import {
  buildReservedVtxoSpend,
  requireOperatorSignedCheckpoint,
  type VtxoReserveResponse,
  vaultArkServer,
  vaultPolicyV1ScriptFromStatus,
} from './spend'
import { VaultPolicyV1Script } from './script'

const TB1Q = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'

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
    operationId: 'op-1',
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
})

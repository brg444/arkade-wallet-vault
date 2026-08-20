import { hex } from '@scure/base'
import { Transaction } from '@scure/btc-signer'
import { beforeEach, describe, expect, it } from 'vitest'
import { pinEnrolledStatus } from './pin'
import {
  buildSavingsPsbt,
  chooseSavingsLeafForStatus,
  finalizeSavingsPsbt,
  parseHardwareSecret,
  psbtFile,
  psbtHexToBase64,
  signSavingsPsbt,
} from './savingsSpend'
import { buildSavingsTree } from './savingsTree'
import type { VaultStatus } from './types'
import { buildV5Descriptor } from './v5/descriptor'
import { V6_FIXTURE, scalarSecret } from './v5/fixtures'
import { buildRecoveryKit } from './v5/kit'
import { saveLocalKit } from './v5/kitStore'

const PHONE = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'
const HARDWARE = '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13'
const PHONE_PRIV = hex.decode('00'.repeat(31) + '03')
const HW_PRIV = hex.decode('00'.repeat(31) + '04')

describe('savings admin PSBT', () => {
  beforeEach(() => localStorage.clear())

  it('phone then hardware can finalize the admin leaf', () => {
    const tree = buildSavingsTree({
      phonePub: PHONE,
      hardwarePub: HARDWARE,
      phoneCsvBlocks: 144,
      hardwareCsvBlocks: 6,
      network: 'mutinynet',
    })
    const leaf = tree.tapLeafScript?.find(
      (entry) => hex.encode(entry[1].slice(0, -1)) === hex.encode(tree.admin.script),
    )
    expect(leaf).toBeTruthy()
    const tx = new Transaction({ version: 2, allowUnknownInputs: true, allowUnknownOutputs: true })
    tx.addInput({
      txid: new Uint8Array(32),
      index: 0,
      witnessUtxo: { script: tree.script, amount: 100_000n },
      tapInternalKey: tree.tapInternalKey,
      tapLeafScript: [leaf!],
      sequence: 0xffffffff,
    })
    tx.addOutput({ script: tree.script, amount: 98_500n })
    const phoneSigned = signSavingsPsbt(hex.encode(tx.toPSBT()), PHONE_PRIV)
    const both = signSavingsPsbt(phoneSigned, HW_PRIV)
    const final = finalizeSavingsPsbt(both)
    expect(final.txHex.length).toBeGreaterThan(100)
    expect(final.txid).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reads a hex hardware secret', () => {
    expect(hex.encode(parseHardwareSecret('00'.repeat(31) + '04'))).toBe(hex.encode(HW_PRIV))
  })

  it('exports a .psbt file wallets can share', () => {
    const tree = buildSavingsTree({
      phonePub: PHONE,
      hardwarePub: HARDWARE,
      phoneCsvBlocks: 144,
      hardwareCsvBlocks: 6,
      network: 'mutinynet',
    })
    const leaf = tree.tapLeafScript?.find(
      (entry) => hex.encode(entry[1].slice(0, -1)) === hex.encode(tree.admin.script),
    )
    const tx = new Transaction({ version: 2, allowUnknownInputs: true, allowUnknownOutputs: true })
    tx.addInput({
      txid: new Uint8Array(32),
      index: 0,
      witnessUtxo: { script: tree.script, amount: 100_000n },
      tapInternalKey: tree.tapInternalKey,
      tapLeafScript: [leaf!],
      sequence: 0xffffffff,
    })
    tx.addOutput({ script: tree.script, amount: 98_500n })
    const hexPsbt = hex.encode(tx.toPSBT())
    const file = psbtFile(hexPsbt)
    expect(file.name).toBe('arkade-savings.psbt')
    expect(file.size).toBeGreaterThan(20)
    expect(psbtHexToBase64(hexPsbt).length).toBeGreaterThan(20)
  })

  it('rebuilds and spends the staged v6 Savings tree instead of the retired two-key tree', () => {
    const descriptor = buildV5Descriptor({
      ...V6_FIXTURE,
      arkadeCosigner: {
        origin: 'https://emulator.mutinynet.arkade.sh',
        version: 'v0.0.7-rc.1',
      },
    })
    const status: VaultStatus = {
      enrolled: true,
      network: descriptor.network,
      clientOrigin: 'https://arkade-vault-demo.vercel.app',
      rpId: 'arkade-vault-demo.vercel.app',
      vaultId: descriptor.vaultId,
      templateVersion: descriptor.templateVersion,
      policyVersion: descriptor.policyVersion,
      operationalCsvBlocks: descriptor.csv.phone,
      savingsCsvBlocks: descriptor.csv.hardware,
      operationalAddress: descriptor.daily.address,
      operationalScript: descriptor.daily.script,
      savingsAddress: descriptor.savings.address,
      savingsScript: descriptor.savings.script,
      savingsExcludesRoutineCosigners: true,
      periodAllowance: descriptor.policy.periodAllowanceSats,
      periodSpent: 0,
      periodRemaining: descriptor.policy.periodAllowanceSats,
      txCap: descriptor.policy.recipientCapSats,
      absoluteFeeCap: descriptor.policy.absoluteFeeCapSats,
      feerateCapSatVb: descriptor.policy.feerateCapSatVb,
      phoneRoutineBip340Pub: descriptor.keys.phoneRoutineBip340,
      externalOwnerWalletPub: descriptor.keys.hardware,
    }
    saveLocalKit(buildRecoveryKit(descriptor))
    pinEnrolledStatus(status)
    expect(
      chooseSavingsLeafForStatus(status, { txid: '11'.repeat(32), vout: 0, value: 100_000, confirmedHeight: 1 }, 1_000),
    ).toBe('admin')
    const unsigned = buildSavingsPsbt({
      status,
      phonePub: descriptor.keys.phoneRoutineBip340,
      destAddress: descriptor.daily.address,
      amountSats: 50_000,
      feeSats: 1_500,
      coin: { txid: '11'.repeat(32), vout: 0, value: 100_000, confirmedHeight: 1 },
      leaf: 'admin',
    })
    const phoneSigned = signSavingsPsbt(unsigned, scalarSecret(3))
    const hardwareSigned = signSavingsPsbt(phoneSigned, scalarSecret(4))
    expect(finalizeSavingsPsbt(hardwareSigned).txid).toMatch(/^[0-9a-f]{64}$/)
  })
})

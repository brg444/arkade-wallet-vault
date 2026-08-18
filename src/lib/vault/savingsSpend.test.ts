import { hex } from '@scure/base'
import { Transaction } from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'
import { finalizeSavingsPsbt, parseHardwareSecret, psbtFile, psbtHexToBase64, signSavingsPsbt } from './savingsSpend'
import { buildSavingsTree } from './savingsTree'

const PHONE = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'
const HARDWARE = '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13'
const PHONE_PRIV = hex.decode('00'.repeat(31) + '03')
const HW_PRIV = hex.decode('00'.repeat(31) + '04')

describe('savings admin PSBT', () => {
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
})

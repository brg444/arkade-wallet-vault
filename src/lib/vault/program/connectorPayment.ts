import { hex } from '@scure/base'
import { OutScript, Transaction } from '@scure/btc-signer'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bitcoinDustSats, scriptHexFromAddress } from '../bitcoin'
import { buildConnectorFamily, connectorEnrollmentDigest, type ConnectorOrigin } from './connector'
import { emulatorPacketScript } from './packet'
import { xOnlyFromCompressed } from '../savingsTree'

const OPTIONS = { version: 2, allowUnknownInputs: true, allowUnknownOutputs: true } as const
type ContractInput = Parameters<typeof connectorEnrollmentDigest>[0]
export interface ConnectorCoin {
  parentHex: string
  txid: string
  vout: number
}

// Pure transaction boundary for the upcoming wallet coordinator. The digest
// must come from the local enrollment pin. Parent confirmation and unspentness
// must be established by the chain adapter before calling this constructor.
export function prepareConnectorPayment(input: {
  contract: ContractInput
  origin: ConnectorOrigin
  enrollmentDigest: string
  savings: ConnectorCoin
  reserve: ConnectorCoin
  recipient: string
  amountSats: number
  feeSats: number
}) {
  if (connectorEnrollmentDigest(input.contract, input.origin) !== input.enrollmentDigest)
    throw new Error('connector enrollment pin mismatch')
  const phonePub = input.contract.phonePub
  const f = buildConnectorFamily(input.contract)
  const scripts = [f.savings.script, f.connector.script]
  const coins = [input.savings, input.reserve]
  if (coins[0].txid === coins[1].txid && coins[0].vout === coins[1].vout) throw new Error('duplicate connector input')
  const tx = new Transaction(OPTIONS)
  const values: bigint[] = []
  const signingLeaf = f.savings.tapLeafScript?.find(
    ([, script]) => hex.encode(script.slice(0, -1)) === hex.encode(f.savings.normal),
  )
  if (!signingLeaf) throw new Error('normal signing leaf missing')
  const derivation: [Uint8Array, { hashes: Uint8Array[]; der: { fingerprint: number; path: number[] } }][] = [
    [
      input.origin.internalKey.slice(),
      { hashes: [], der: { fingerprint: input.origin.fingerprint, path: [...input.origin.path] } },
    ],
  ]
  for (const [index, coin] of coins.entries()) {
    if (
      !/^[0-9a-f]{64}$/.test(coin.txid) ||
      !Number.isInteger(coin.vout) ||
      coin.vout < 0 ||
      coin.vout > 0xffffffff ||
      coin.parentHex.length > 2_000_000
    )
      throw new Error('invalid connector parent')
    const raw = hex.decode(coin.parentHex)
    const parent = Transaction.fromRaw(raw, OPTIONS)
    if (parent.id !== coin.txid) throw new Error('connector parent hash mismatch')
    const out = parent.getOutput(coin.vout)
    if (
      out.amount === undefined ||
      out.amount <= 0n ||
      out.amount > 2_100_000_000_000_000n ||
      !out.script ||
      hex.encode(out.script) !== hex.encode(scripts[index])
    )
      throw new Error('connector prevout mismatch')
    values.push(out.amount)
    tx.addInput({
      txid: coin.txid,
      index: coin.vout,
      sequence: 0xfffffffd,
      nonWitnessUtxo: raw,
      witnessUtxo: { amount: out.amount, script: out.script },
      unknown: [[{ type: 222, key: new TextEncoder().encode('prevouttx') }, raw]],
      ...(index === 0
        ? { tapLeafScript: [signingLeaf], tapInternalKey: f.savings.tapInternalKey }
        : { tapInternalKey: input.origin.internalKey, tapBip32Derivation: derivation }),
    })
  }
  if (values[1] !== 1000n || values[0] + values[1] > 2_100_000_000_000_000n)
    throw new Error('invalid reserve or total value')
  const recipientScript = hex.decode(scriptHexFromAddress(input.recipient, input.contract.network))
  if (!['pkh', 'sh', 'wpkh', 'wsh', 'tr'].includes(OutScript.decode(recipientScript).type))
    throw new Error('unsupported Bitcoin payment script')
  const dust = bitcoinDustSats(input.recipient, input.contract.network)
  if (
    !Number.isSafeInteger(input.amountSats) ||
    input.amountSats < dust ||
    !Number.isSafeInteger(input.feeSats) ||
    input.feeSats < 0 ||
    input.feeSats > f.rules.absoluteFeeCapSats
  )
    throw new Error('invalid connector amount or fee')
  const change = values[0] - BigInt(input.amountSats) - BigInt(input.feeSats) - 240n
  if (change < 0n || (change > 0n && change < 330n)) throw new Error('Savings change must be absent or non-dust')
  tx.addOutput({
    script: recipientScript,
    amount: BigInt(input.amountSats),
  })
  tx.addOutput({
    script: f.connector.script,
    amount: 1000n,
    tapInternalKey: input.origin.internalKey,
    tapBip32Derivation: derivation,
  })
  tx.addOutput({ script: hex.decode('51024e73'), amount: 240n })
  tx.addOutput({ script: emulatorPacketScript(f.program, false), amount: 0n })
  if (change > 0n) tx.addOutput({ script: f.savings.script, amount: change })
  const unsigned = tx.unsignedTx
  const vbytes = Math.ceil((unsigned.length * 4 + f.rules.witnessBytes) / 4)
  if (input.feeSats > vbytes * f.rules.feerateCapSatPerV) throw new Error('connector feerate cap exceeded')
  const prepared = tx.toPSBT()
  return {
    psbt: () => hex.encode(prepared.slice()),
    forHardware(witness: Uint8Array[]) {
      if (
        witness.length !== 5 ||
        witness.slice(0, 3).some((sig) => sig.length !== 64) ||
        hex.encode(witness[3]) !== hex.encode(f.savings.normal) ||
        hex.encode(witness[4]) !== hex.encode(f.savings.control)
      )
        throw new Error('invalid Savings witness')
      const message = tx.preimageWitnessV1(0, scripts, 0, values, -1, f.savings.normal)
      const pubs = [f.normalTweaks.arkade, f.normalTweaks.vault, phonePub].map(xOnlyFromCompressed)
      if (pubs.some((pub, i) => !schnorr.verify(witness[i], message, pub))) throw new Error('invalid Savings signature')
      const savedWitness = witness.map((item) => item.slice())
      const hardware = Transaction.fromPSBT(prepared, OPTIONS)
      hardware.updateInput(0, { finalScriptWitness: savedWitness, tapLeafScript: undefined, tapInternalKey: undefined })
      const hardwarePSBT = hardware.toPSBT()
      return {
        psbt: () => hex.encode(hardwarePSBT.slice()),
        accept(responseHex: string) {
          if (responseHex.length > 4_000_000) throw new Error('hardware PSBT too large')
          const response = Transaction.fromPSBT(hex.decode(responseHex), OPTIONS)
          if (hex.encode(response.unsignedTx) !== hex.encode(unsigned)) throw new Error('hardware changed transaction')
          for (let i = 0; i < 2; i++) {
            const returned = response.getInput(i)
            if (returned.sighashType !== undefined && returned.sighashType !== 0) throw new Error('non-DEFAULT sighash')
            if (
              returned.witnessUtxo &&
              (returned.witnessUtxo.amount !== values[i] ||
                hex.encode(returned.witnessUtxo.script) !== hex.encode(scripts[i]))
            )
              throw new Error('hardware changed prevout')
          }
          const approval = response.getInput(1)
          if (approval.tapScriptSig?.length || approval.finalScriptSig?.length)
            throw new Error('unexpected connector signing path')
          const finalWitness = approval.finalScriptWitness
          if (finalWitness && (finalWitness.length !== 1 || finalWitness[0].length !== 64))
            throw new Error('invalid hardware witness')
          const sig = finalWitness?.[0] ?? approval.tapKeySig
          if (
            !sig ||
            sig.length !== 64 ||
            (finalWitness && approval.tapKeySig && hex.encode(sig) !== hex.encode(approval.tapKeySig))
          )
            throw new Error('invalid hardware signature encoding')
          if (!schnorr.verify(sig, tx.preimageWitnessV1(1, scripts, 0, values), f.connector.script.slice(2)))
            throw new Error('invalid hardware signature')
          const result = Transaction.fromPSBT(hardwarePSBT, OPTIONS)
          result.updateInput(1, { finalScriptWitness: [sig.slice()] })
          return { txHex: hex.encode(result.extract()), txid: result.id }
        },
      }
    },
  }
}

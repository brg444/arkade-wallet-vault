import { hex } from '@scure/base'
import { Transaction } from '@scure/btc-signer'
import { scriptHexFromAddress } from '../bitcoin'
import { ABSOLUTE_FEE_CEILING_SATS, DUST_SATS, FEERATE_CEILING_SAT_PER_V } from '../constants'
import {
  P2A_SCRIPT_HEX,
  P2A_VALUE_SATS,
  TRANSITION_OUTPUT_COUNT,
  TRANSITION_SEQUENCE,
  type Claimant,
  type FamilyKey,
  type VaultKind,
} from './constants'
import { emulatorPacketScript } from './packet'
import { clawbackWitnessBytes, initiateWitnessBytes } from './script'
import { pendingDelay, pendingGuardians, type V5Family } from './trees'

const TX_OPTS = { version: 2, lockTime: 0, allowUnknownInputs: true, allowUnknownOutputs: true } as const

export type { V5Family }

export interface V5Coin {
  txid: string
  vout: number
  value: number
}

function familyKey(kind: VaultKind, claimant: Claimant): FamilyKey {
  return `${kind}-${claimant}`
}

function requireCoin(coin: V5Coin) {
  const txid = coin.txid.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('txid must be 32-byte hex')
  if (!Number.isInteger(coin.vout) || coin.vout < 0) throw new Error('vout required')
  if (!Number.isInteger(coin.value) || coin.value < DUST_SATS) throw new Error('coin value required')
  return { txid, vout: coin.vout, value: coin.value }
}

function requireFee(feeSats: number) {
  if (!Number.isInteger(feeSats) || feeSats < 0) throw new Error('fee required')
  if (feeSats > ABSOLUTE_FEE_CEILING_SATS) throw new Error('fee exceeds the absolute cap')
  return feeSats
}

export function tapLeafForScript(
  tapLeafScript: [unknown, Uint8Array][] | undefined,
  script: Uint8Array,
): [unknown, Uint8Array] {
  const leaf = tapLeafScript?.find((entry) => hex.encode(entry[1].slice(0, -1)) === hex.encode(script))
  if (!leaf) throw new Error('tap leaf missing from tree')
  return leaf
}

function addTransitionOutputs(tx: Transaction, dest: Uint8Array, destSats: number, packet: Uint8Array) {
  tx.addOutput({ script: dest, amount: BigInt(destSats) })
  tx.addOutput({ script: hex.decode(P2A_SCRIPT_HEX), amount: BigInt(P2A_VALUE_SATS) })
  tx.addOutput({ script: packet, amount: 0n })
}

function transitionDestSats(value: number, feeSats: number) {
  const dest = value - feeSats - P2A_VALUE_SATS
  if (dest < DUST_SATS) throw new Error('transition dest is below dust')
  return dest
}

export function buildInitiatePsbt(input: {
  family: V5Family
  kind: VaultKind
  claimant: Claimant
  coin: V5Coin
  feeSats: number
}): { psbtHex: string; destAddress: string; authScript: Uint8Array; destSats: number } {
  const coin = requireCoin(input.coin)
  const feeSats = requireFee(input.feeSats)
  const key = familyKey(input.kind, input.claimant)
  const source = input.kind === 'daily' ? input.family.daily : input.family.savings
  const destTree = input.family.pending[key]
  const authScript = input.family.initiateAuth[key]
  const destSats = transitionDestSats(coin.value, feeSats)
  const leaf = tapLeafForScript(
    source.tapLeafScript,
    source.initiate[['phone', 'hardware', 'recovery'].indexOf(input.claimant)],
  )
  const tx = new Transaction(TX_OPTS)
  tx.addInput({
    txid: hex.decode(coin.txid),
    index: coin.vout,
    witnessUtxo: { script: source.script, amount: BigInt(coin.value) },
    tapInternalKey: source.tapInternalKey,
    tapLeafScript: [leaf],
    sequence: TRANSITION_SEQUENCE,
  })
  addTransitionOutputs(tx, destTree.script, destSats, emulatorPacketScript(authScript, input.claimant === 'phone'))
  return { psbtHex: hex.encode(tx.toPSBT()), destAddress: destTree.address, authScript, destSats }
}

export function buildClawbackPsbt(input: {
  family: V5Family
  kind: VaultKind
  claimant: Claimant
  guardian: Claimant
  coin: V5Coin
  feeSats: number
}): { psbtHex: string; destAddress: string; authScript: Uint8Array; destSats: number } {
  const coin = requireCoin(input.coin)
  const feeSats = requireFee(input.feeSats)
  const guardians = pendingGuardians(input.claimant)
  const guardianIndex = guardians.indexOf(input.guardian)
  if (guardianIndex < 0) throw new Error('guardian cannot claw back this pending output')
  const key = familyKey(input.kind, input.claimant)
  const source = input.family.pending[key]
  const destTree = input.family.quarantine[key]
  const authScript = input.family.clawbackAuth[key]
  const destSats = transitionDestSats(coin.value, feeSats)
  const leaf = tapLeafForScript(source.tapLeafScript, source.clawbacks[guardianIndex])
  const tx = new Transaction(TX_OPTS)
  tx.addInput({
    txid: hex.decode(coin.txid),
    index: coin.vout,
    witnessUtxo: { script: source.script, amount: BigInt(coin.value) },
    tapInternalKey: source.tapInternalKey,
    tapLeafScript: [leaf],
    sequence: TRANSITION_SEQUENCE,
  })
  addTransitionOutputs(tx, destTree.script, destSats, emulatorPacketScript(authScript, false))
  return { psbtHex: hex.encode(tx.toPSBT()), destAddress: destTree.address, authScript, destSats }
}

export function buildClaimPsbt(input: {
  family: V5Family
  kind: VaultKind
  claimant: Claimant
  coin: V5Coin
  destAddress: string
  feeSats: number
  network: string
}): { psbtHex: string; destSats: number } {
  const coin = requireCoin(input.coin)
  const feeSats = requireFee(input.feeSats)
  const destSats = coin.value - feeSats
  if (destSats < DUST_SATS) throw new Error('claim dest is below dust')
  const key = familyKey(input.kind, input.claimant)
  const source = input.family.pending[key]
  const dest = hex.decode(scriptHexFromAddress(input.destAddress, input.network))
  const leaf = tapLeafForScript(source.tapLeafScript, source.claim)
  const tx = new Transaction(TX_OPTS)
  tx.addInput({
    txid: hex.decode(coin.txid),
    index: coin.vout,
    witnessUtxo: { script: source.script, amount: BigInt(coin.value) },
    tapInternalKey: source.tapInternalKey,
    tapLeafScript: [leaf],
    sequence: pendingDelay(input.claimant),
  })
  tx.addOutput({ script: dest, amount: BigInt(destSats) })
  return { psbtHex: hex.encode(tx.toPSBT()), destSats }
}

export function inspectTransitionPsbt(psbtHex: string) {
  const tx = Transaction.fromPSBT(hex.decode(psbtHex), TX_OPTS)
  if (tx.inputsLength !== 1) throw new Error('transition must have one input')
  if (tx.outputsLength !== TRANSITION_OUTPUT_COUNT) throw new Error('transition must have dest, P2A, and packet')
  const input = tx.getInput(0)
  const dest = tx.getOutput(0)
  const p2a = tx.getOutput(1)
  const packet = tx.getOutput(2)
  if (!input.witnessUtxo || dest.amount === undefined || !dest.script || !p2a.script || !packet.script) {
    throw new Error('incomplete transition psbt')
  }
  if (input.sequence !== TRANSITION_SEQUENCE) throw new Error('transition sequence must signal RBF')
  if (hex.encode(p2a.script) !== P2A_SCRIPT_HEX) throw new Error('P2A script mismatch')
  if (p2a.amount !== BigInt(P2A_VALUE_SATS)) throw new Error('P2A value mismatch')
  if (packet.amount !== 0n) throw new Error('packet must be zero value')
  const value = Number(input.witnessUtxo.amount)
  const destSats = Number(dest.amount)
  const feeSats = value - destSats - P2A_VALUE_SATS
  if (feeSats < 0) throw new Error('negative fee')
  return {
    version: tx.version,
    sequence: input.sequence,
    destScript: hex.encode(dest.script),
    destSats,
    feeSats,
    p2aSats: Number(p2a.amount),
    packetScript: hex.encode(packet.script),
    inputScript: hex.encode(input.witnessUtxo.script),
  }
}

export function inspectClaimPsbt(psbtHex: string) {
  const tx = Transaction.fromPSBT(hex.decode(psbtHex), TX_OPTS)
  if (tx.inputsLength !== 1) throw new Error('claim must have one input')
  if (tx.outputsLength !== 1) throw new Error('claim must pay a single dest')
  const input = tx.getInput(0)
  const dest = tx.getOutput(0)
  if (!input.witnessUtxo || dest.amount === undefined || !dest.script) throw new Error('incomplete claim psbt')
  if (input.sequence === TRANSITION_SEQUENCE || input.sequence === 0xffffffff) {
    throw new Error('claim sequence must be the pending CSV delay')
  }
  const value = Number(input.witnessUtxo.amount)
  const destSats = Number(dest.amount)
  return {
    version: tx.version,
    sequence: input.sequence ?? 0,
    destScript: hex.encode(dest.script),
    destSats,
    feeSats: value - destSats,
  }
}

export function estimateTransitionVbytes(stripped: number, witnessBytes: number) {
  return Math.floor((stripped * 4 + witnessBytes + 3) / 4)
}

export function assertTransitionFee(feeSats: number, stripped: number, witnessBytes: number) {
  if (feeSats > ABSOLUTE_FEE_CEILING_SATS) throw new Error('fee exceeds the absolute cap')
  const vbytes = estimateTransitionVbytes(stripped, witnessBytes)
  if (feeSats > FEERATE_CEILING_SAT_PER_V * vbytes) throw new Error('fee exceeds the feerate cap')
}

export { initiateWitnessBytes, clawbackWitnessBytes }

import { hex } from '@scure/base'
import { Transaction } from '@scure/btc-signer'
import { scriptHexFromAddress } from '../bitcoin'
import { requireExactDefaultTapscriptSignatures, xOnlyTapscriptPub } from '../taprootSignatures'
import { type Claimant } from './constants'
import { pendingGuardians } from './trees'

const TX_OPTS = { version: 2, lockTime: 0, allowUnknownInputs: true, allowUnknownOutputs: true } as const

export const GUARDIAN_EXIT_SEQUENCE = 0xfffffffd

const SIGNER_LABEL: Record<Claimant, string> = {
  phone: 'This device',
  hardware: 'Hardware',
  recovery: 'Recovery',
}

export function requiredGuardianExitSigners(claimant: Claimant, hasRecovery: boolean): Claimant[] {
  return pendingGuardians(claimant, hasRecovery)
}

export function describeGuardianExitSigners(signers: Claimant[]): string {
  const labels = signers.map((role) => SIGNER_LABEL[role])
  if (labels.length === 0) return 'No remaining keys'
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

export function assertGuardianExitSigners(claimant: Claimant, signers: Claimant[]) {
  if (signers.includes(claimant)) {
    throw new Error('the key that started recovery cannot sign the cancellation')
  }
  if (signers.length === 0) throw new Error('no remaining keys to cancel this recovery')
}

export interface GuardianExitView {
  inputTxid: string
  inputVout: number
  destScript: string
  destSats: number
  feeSats: number
  sequence: number
  leafScript: string
  signatures: number
  signaturePubs: string[]
}

export function inspectGuardianExitPsbt(psbtHex: string): GuardianExitView {
  const tx = Transaction.fromPSBT(hex.decode(psbtHex), TX_OPTS)
  if (tx.inputsLength !== 1) throw new Error('cancel must have one input')
  if (tx.outputsLength !== 1) throw new Error('cancel must pay a single dest')
  const input = tx.getInput(0)
  const dest = tx.getOutput(0)
  if (!input.witnessUtxo || dest.amount === undefined || !dest.script) throw new Error('incomplete cancel psbt')
  if (input.sequence !== GUARDIAN_EXIT_SEQUENCE) throw new Error('cancel sequence must signal RBF')
  const leaf = input.tapLeafScript?.[0]
  if (!leaf) throw new Error('cancel leaf missing')
  return {
    inputTxid: hex.encode(input.txid || new Uint8Array()),
    inputVout: input.index ?? 0,
    destScript: hex.encode(dest.script),
    destSats: Number(dest.amount),
    feeSats: Number(input.witnessUtxo.amount) - Number(dest.amount),
    sequence: input.sequence ?? 0,
    leafScript: hex.encode(leaf[1].slice(0, -1)),
    signatures: (input.tapScriptSig || []).length,
    signaturePubs: (input.tapScriptSig || []).map(([key]) => hex.encode(key.pubKey)).sort(),
  }
}

export function acceptGuardianExitSignature(originalHex: string, signedHex: string, expectedPub: string): string {
  assertGuardianExitPreserved(originalHex, signedHex)
  const before = inspectGuardianExitPsbt(originalHex)
  const after = inspectGuardianExitPsbt(signedHex)
  if (after.signatures !== before.signatures + 1) throw new Error('signed cancel must add exactly one signature')
  const expected = expectedPub
    .trim()
    .toLowerCase()
    .replace(/^(02|03)/, '')
  if (!/^[0-9a-f]{64}$/.test(expected) || !after.signaturePubs.includes(expected)) {
    throw new Error('signed cancel was not signed by the requested key')
  }
  requireExactDefaultTapscriptSignatures(Transaction.fromPSBT(hex.decode(signedHex), TX_OPTS), 0, [
    ...before.signaturePubs,
    xOnlyTapscriptPub(expectedPub, 'requested signer'),
  ])
  return signedHex
}

export function assertGuardianExitPreserved(originalHex: string, nextHex: string) {
  const original = inspectGuardianExitPsbt(originalHex)
  const next = inspectGuardianExitPsbt(nextHex)
  if (original.inputTxid !== next.inputTxid || original.inputVout !== next.inputVout) {
    throw new Error('cancel input changed')
  }
  if (original.destScript !== next.destScript) throw new Error('cancel destination changed')
  if (original.destSats !== next.destSats || original.feeSats !== next.feeSats) {
    throw new Error('cancel fee changed')
  }
  if (original.leafScript !== next.leafScript) throw new Error('cancel leaf changed')
  if (original.sequence !== next.sequence) throw new Error('cancel sequence changed')
  if (next.signatures < original.signatures) throw new Error('cancel signatures were removed')
}

export function signGuardianExitPsbt(psbtHex: string, secret: Uint8Array): string {
  if (secret.length !== 32) throw new Error('private key must be 32 bytes')
  const before = inspectGuardianExitPsbt(psbtHex)
  const tx = Transaction.fromPSBT(hex.decode(psbtHex), TX_OPTS)
  try {
    tx.sign(secret)
  } catch {
    throw new Error('that key is not a remaining cancel signer')
  }
  const next = hex.encode(tx.toPSBT())
  assertGuardianExitPreserved(psbtHex, next)
  const after = inspectGuardianExitPsbt(next)
  if (after.signatures !== before.signatures + 1) throw new Error('that key is not a remaining cancel signer')
  return next
}

export function finalizeGuardianExit(psbtHex: string, requiredSignatures: number): { txHex: string; txid: string } {
  const view = inspectGuardianExitPsbt(psbtHex)
  if (view.signatures < requiredSignatures) throw new Error('not every remaining key has signed')
  const tx = Transaction.fromPSBT(hex.decode(psbtHex), TX_OPTS)
  tx.finalize()
  const raw = tx.extract()
  return { txHex: hex.encode(raw), txid: tx.id }
}

export function destScriptHex(address: string, network: string): string {
  return scriptHexFromAddress(address, network)
}

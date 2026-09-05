import { scriptFromTapLeafScript, Transaction, verifyTapscriptSignatures } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { SigHash } from '@scure/btc-signer'
import { tapLeafHash } from '@scure/btc-signer/payment.js'

export function xOnlyTapscriptPub(value: string, name: string): string {
  const key = String(value || '')
    .trim()
    .toLowerCase()
  const xonly = /^(02|03)[0-9a-f]{64}$/.test(key) ? key.slice(2) : key
  if (!/^[0-9a-f]{64}$/.test(xonly)) throw new Error(`${name} must be a compressed or x-only public key`)
  return xonly
}

export function tapscriptSignatureRecords(tx: Transaction, inputIndex: number): string[] {
  return (tx.getInput(inputIndex).tapScriptSig || [])
    .map(([data, signature]) => `${hex.encode(data.pubKey)}:${hex.encode(data.leafHash)}:${hex.encode(signature)}`)
    .sort()
}

export function requireExactDefaultTapscriptSignatures(
  tx: Transaction,
  inputIndex: number,
  expectedPubs: string[],
): void {
  const input = tx.getInput(inputIndex)
  if (input.tapKeySig) throw new Error(`input ${inputIndex} must not contain a Taproot key-path signature`)
  if (input.sighashType !== undefined && input.sighashType !== SigHash.DEFAULT) {
    throw new Error(`input ${inputIndex} must use SIGHASH_DEFAULT`)
  }
  if (input.tapLeafScript?.length !== 1) throw new Error(`input ${inputIndex} must carry exactly one tapleaf`)
  const expected = expectedPubs.map((pub, index) => xOnlyTapscriptPub(pub, `signer ${index}`)).sort()
  const signatures = input.tapScriptSig || []
  const actual = signatures.map(([data]) => hex.encode(data.pubKey)).sort()
  if (actual.length !== expected.length || actual.some((pub, index) => pub !== expected[index])) {
    throw new Error(`input ${inputIndex} has the wrong tapscript signer set`)
  }
  const leaf = input.tapLeafScript[0]
  const scriptWithVersion = leaf[1]
  const leafHash = tapLeafHash(scriptFromTapLeafScript(leaf), scriptWithVersion[scriptWithVersion.length - 1])
  verifyTapscriptSignatures(tx, inputIndex, expected, [], [SigHash.DEFAULT], leafHash)
}

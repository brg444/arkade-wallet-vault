import { hex } from '@scure/base'
import { ABSOLUTE_FEE_CEILING_SATS, DUST_SATS, FEERATE_CEILING_SAT_PER_V } from '../constants'
import { P2A_OUTPUT_INDEX, P2A_SCRIPT_HEX, P2A_VALUE_SATS, TRANSITION_SEQUENCE } from './constants'

export { TRANSITION_SEQUENCE }

export const OP = {
  VERIFY: 0x69,
  EQUAL: 0x87,
  EQUALVERIFY: 0x88,
  ADD: 0x93,
  SUB: 0x94,
  MUL: 0x95,
  DIV: 0x96,
  GREATERTHANOREQUAL: 0xa2,
  LESSTHANOREQUAL: 0xa1,
  DUP: 0x76,
  DROP: 0x75,
  SHA256: 0xa8,
  CAT: 0x7e,
  INSPECTINPUTVALUE: 0xc9,
  INSPECTINPUTSEQUENCE: 0xcb,
  CHECKSIGFROMSTACK: 0xcc,
  INSPECTOUTPUTVALUE: 0xcf,
  INSPECTOUTPUTSCRIPTPUBKEY: 0xd1,
  INSPECTVERSION: 0xd2,
  INSPECTLOCKTIME: 0xd3,
  INSPECTNUMINPUTS: 0xd4,
  INSPECTNUMOUTPUTS: 0xd5,
  TXWEIGHT: 0xd6,
  SIGHASH: 0xf6,
} as const

/** Arkade CSFS prefix for PhoneDirectP256 (not WebAuthn ES256). */
export const DIRECT_P256_CSFS_PREFIX = 0x11

/**
 * Serialized witness size the feerate check assumes.
 * Matches the v4 3-of-3 measurement. Deeper Normal trees need a measured
 * replacement before fee-race tests; too small rejects honest txs.
 */
export const TRANSITION_WITNESS_BYTES = 399

function scriptNum(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array()
  const neg = value < 0n
  let abs = neg ? -value : value
  const bytes: number[] = []
  while (abs > 0n) {
    bytes.push(Number(abs & 0xffn))
    abs >>= 8n
  }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(neg ? 0x80 : 0)
  else if (neg) bytes[bytes.length - 1] |= 0x80
  return new Uint8Array(bytes)
}

export function pushInt(value: number | bigint): Uint8Array {
  const n = BigInt(value)
  if (n === 0n) return new Uint8Array([0x00])
  if (n >= 1n && n <= 16n) return new Uint8Array([0x50 + Number(n)])
  if (n === -1n) return new Uint8Array([0x4f])
  const raw = scriptNum(n)
  return new Uint8Array([raw.length, ...raw])
}

export function pushData(data: Uint8Array): Uint8Array {
  if (data.length <= 75) return new Uint8Array([data.length, ...data])
  if (data.length <= 255) return new Uint8Array([0x4c, data.length, ...data])
  throw new Error('push too large')
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function p2trProgram(scriptHex: string): Uint8Array {
  const raw = hex.decode(scriptHex)
  if (raw.length !== 34 || raw[0] !== 0x51 || raw[1] !== 0x20) {
    throw new Error('dest must be a 34-byte p2tr script')
  }
  return raw.slice(2)
}

function p2aProgram(): Uint8Array {
  const raw = hex.decode(P2A_SCRIPT_HEX)
  if (raw[0] !== 0x51 || raw[1] !== 0x02) throw new Error('P2A script')
  return raw.slice(2)
}

export type TransitionKind = 'initiate' | 'clawback'

export function buildTransitionScript(input: {
  destScriptHex: string
  bindPhoneDirect?: Uint8Array
  feeCap?: number
  feerateCap?: number
}): Uint8Array {
  const dest = p2trProgram(input.destScriptHex)
  const feeCap = input.feeCap ?? ABSOLUTE_FEE_CEILING_SATS
  const feerateCap = input.feerateCap ?? FEERATE_CEILING_SAT_PER_V
  const parts: Uint8Array[] = [
    new Uint8Array([OP.INSPECTVERSION]),
    pushInt(2),
    new Uint8Array([OP.EQUALVERIFY]),
    new Uint8Array([OP.INSPECTLOCKTIME]),
    pushInt(0),
    new Uint8Array([OP.EQUALVERIFY]),
    new Uint8Array([OP.INSPECTNUMINPUTS]),
    pushInt(1),
    new Uint8Array([OP.EQUALVERIFY]),
    pushInt(0),
    new Uint8Array([OP.INSPECTINPUTSEQUENCE]),
    pushInt(TRANSITION_SEQUENCE),
    new Uint8Array([OP.EQUALVERIFY]),
    new Uint8Array([OP.INSPECTNUMOUTPUTS]),
    pushInt(2),
    new Uint8Array([OP.EQUALVERIFY]),
    pushInt(0),
    new Uint8Array([OP.INSPECTOUTPUTSCRIPTPUBKEY]),
    pushInt(1),
    new Uint8Array([OP.EQUALVERIFY]),
    pushData(dest),
    new Uint8Array([OP.EQUALVERIFY]),
    pushInt(0),
    new Uint8Array([OP.INSPECTOUTPUTVALUE]),
    pushInt(DUST_SATS),
    new Uint8Array([OP.GREATERTHANOREQUAL, OP.VERIFY]),
    pushInt(P2A_OUTPUT_INDEX),
    new Uint8Array([OP.INSPECTOUTPUTSCRIPTPUBKEY]),
    pushInt(1),
    new Uint8Array([OP.EQUALVERIFY]),
    pushData(p2aProgram()),
    new Uint8Array([OP.EQUALVERIFY]),
    pushInt(P2A_OUTPUT_INDEX),
    new Uint8Array([OP.INSPECTOUTPUTVALUE]),
    pushInt(P2A_VALUE_SATS),
    new Uint8Array([OP.EQUALVERIFY]),
    pushInt(0),
    new Uint8Array([OP.INSPECTINPUTVALUE]),
    pushInt(0),
    new Uint8Array([OP.INSPECTOUTPUTVALUE]),
    new Uint8Array([OP.SUB]),
    new Uint8Array([OP.DUP]),
    pushInt(0),
    new Uint8Array([OP.GREATERTHANOREQUAL, OP.VERIFY]),
    new Uint8Array([OP.DUP]),
    pushInt(feeCap),
    new Uint8Array([OP.LESSTHANOREQUAL, OP.VERIFY]),
    new Uint8Array([OP.DUP]),
    new Uint8Array([OP.TXWEIGHT]),
    pushInt(TRANSITION_WITNESS_BYTES),
    new Uint8Array([OP.ADD]),
    pushInt(3),
    new Uint8Array([OP.ADD]),
    pushInt(4),
    new Uint8Array([OP.DIV]),
    pushInt(feerateCap),
    new Uint8Array([OP.MUL]),
    new Uint8Array([OP.LESSTHANOREQUAL, OP.VERIFY]),
    new Uint8Array([OP.DROP]),
  ]
  if (input.bindPhoneDirect) {
    if (input.bindPhoneDirect.length !== 33) throw new Error('PhoneDirectP256 must be 33 bytes')
    if (input.bindPhoneDirect[0] !== 0x02 && input.bindPhoneDirect[0] !== 0x03) {
      throw new Error('PhoneDirectP256 must be compressed')
    }
    parts.push(
      pushInt(0),
      new Uint8Array([OP.SIGHASH]),
      pushData(new Uint8Array([DIRECT_P256_CSFS_PREFIX, ...input.bindPhoneDirect])),
      new Uint8Array([OP.CHECKSIGFROMSTACK]),
    )
  }
  return concat(...parts)
}

export function scriptContains(script: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > script.length) return false
  outer: for (let i = 0; i <= script.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (script[i + j] !== needle[j]) continue outer
    }
    return true
  }
  return false
}

export function assertTransitionScript(script: Uint8Array, destScriptHex: string, phoneBound: boolean) {
  if (!scriptContains(script, p2trProgram(destScriptHex))) throw new Error('dest program not pinned')
  if (!scriptContains(script, p2aProgram())) throw new Error('P2A program not pinned')
  if (!scriptContains(script, pushInt(TRANSITION_SEQUENCE))) throw new Error('RBF sequence not pinned')
  // CSFS is only the last opcode. Dest programs can contain 0xcc.
  const hasCsfs = script.length > 0 && script[script.length - 1] === OP.CHECKSIGFROMSTACK
  if (phoneBound !== hasCsfs) throw new Error('PhoneDirect bind mismatch')
}

export { concat }

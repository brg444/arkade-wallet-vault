import { p256 } from '@noble/curves/nist.js'
import { hex } from '@scure/base'
import { ABSOLUTE_FEE_CEILING_SATS, DUST_SATS, FEERATE_CEILING_SAT_PER_V } from '../constants'
import {
  PACKET_OUTPUT_INDEX,
  P2A_OUTPUT_INDEX,
  P2A_SCRIPT_HEX,
  P2A_VALUE_SATS,
  TRANSITION_OUTPUT_COUNT,
  TRANSITION_SEQUENCE,
  type Claimant,
  type VaultKind,
  WITNESS_BYTES_367,
  WITNESS_BYTES_399,
  WITNESS_BYTES_431,
} from './constants'
import { EMULATOR_PACKET_TYPE, exactPacketOutputPrefix, packetWitnessShape } from './packet'

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
  SWAP: 0x7c,
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
  INSPECTPACKET: 0xf4,
  SIGHASH: 0xf6,
} as const

/** Arkade CSFS prefix for PhoneDirectP256 (not WebAuthn ES256). */
export const DIRECT_P256_CSFS_PREFIX = 0x11

export const TRANSITION_WITNESS_BYTES = WITNESS_BYTES_399

export function initiateWitnessBytes(kind: VaultKind, claimant: Claimant, hasRecovery = true): number {
  if (hasRecovery) {
    if (kind === 'daily' && (claimant === 'phone' || claimant === 'hardware')) return WITNESS_BYTES_431
    return WITNESS_BYTES_399
  }
  if (kind === 'savings' && claimant === 'hardware') return WITNESS_BYTES_367
  return WITNESS_BYTES_399
}

export function clawbackWitnessBytes(): number {
  return WITNESS_BYTES_399
}

export function collaborativeWitnessBytes(script: Uint8Array, controlBlock: Uint8Array): number {
  return (
    2 +
    1 +
    3 * (1 + 64) +
    compactSizeLen(script.length) +
    script.length +
    compactSizeLen(controlBlock.length) +
    controlBlock.length
  )
}

function compactSizeLen(n: number): number {
  if (n < 0xfd) return 1
  if (n <= 0xffff) return 3
  if (n <= 0xffffffff) return 5
  return 9
}

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

function requirePhoneDirect(pub: Uint8Array): Uint8Array {
  if (pub.length !== 33) throw new Error('PhoneDirectP256 must be 33 bytes')
  if (pub[0] !== 0x02 && pub[0] !== 0x03) throw new Error('PhoneDirectP256 must be compressed')
  if (!p256.utils.isValidPublicKey(pub, true)) throw new Error('PhoneDirectP256 is off-curve')
  return pub
}

export function buildTransitionScript(input: {
  destScriptHex: string
  bindPhoneDirect?: Uint8Array
  witnessBytes?: number
  feeCap?: number
  feerateCap?: number
}): Uint8Array {
  const dest = p2trProgram(input.destScriptHex)
  const feeCap = input.feeCap ?? ABSOLUTE_FEE_CEILING_SATS
  const feerateCap = input.feerateCap ?? FEERATE_CEILING_SAT_PER_V
  const witnessBytes = input.witnessBytes ?? TRANSITION_WITNESS_BYTES
  const phone = input.bindPhoneDirect ? requirePhoneDirect(input.bindPhoneDirect) : undefined
  const witnessShape = packetWitnessShape(!!phone)
  let prefix = new Uint8Array()
  for (let i = 0; i < 8; i++) {
    const script = assembleTransitionScript({
      dest,
      prefix,
      phone,
      witnessBytes,
      feeCap,
      feerateCap,
    })
    const next = exactPacketOutputPrefix(script.length, witnessShape)
    if (next.length === prefix.length && next.every((b, j) => b === prefix[j])) return script
    prefix = next
  }
  throw new Error('authorization script packet envelope did not converge')
}

function assembleTransitionScript(input: {
  dest: Uint8Array
  prefix: Uint8Array
  phone?: Uint8Array
  witnessBytes: number
  feeCap: number
  feerateCap: number
}): Uint8Array {
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
    pushInt(TRANSITION_OUTPUT_COUNT),
    new Uint8Array([OP.EQUALVERIFY]),
    pushInt(0),
    new Uint8Array([OP.INSPECTOUTPUTSCRIPTPUBKEY]),
    pushInt(1),
    new Uint8Array([OP.EQUALVERIFY]),
    pushData(input.dest),
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
    pushInt(PACKET_OUTPUT_INDEX),
    new Uint8Array([OP.INSPECTOUTPUTVALUE]),
    pushInt(0),
    new Uint8Array([OP.EQUALVERIFY]),
    pushInt(EMULATOR_PACKET_TYPE),
    new Uint8Array([OP.INSPECTPACKET, OP.VERIFY]),
    pushData(input.prefix),
    new Uint8Array([OP.SWAP, OP.CAT, OP.SHA256]),
    pushInt(PACKET_OUTPUT_INDEX),
    new Uint8Array([OP.INSPECTOUTPUTSCRIPTPUBKEY]),
    pushInt(-1),
    new Uint8Array([OP.EQUALVERIFY, OP.EQUALVERIFY]),
    pushInt(0),
    new Uint8Array([OP.INSPECTINPUTVALUE]),
    pushInt(0),
    new Uint8Array([OP.INSPECTOUTPUTVALUE]),
    new Uint8Array([OP.SUB]),
    pushInt(P2A_OUTPUT_INDEX),
    new Uint8Array([OP.INSPECTOUTPUTVALUE]),
    new Uint8Array([OP.SUB]),
    new Uint8Array([OP.DUP]),
    pushInt(0),
    new Uint8Array([OP.GREATERTHANOREQUAL, OP.VERIFY]),
    new Uint8Array([OP.DUP]),
    pushInt(input.feeCap),
    new Uint8Array([OP.LESSTHANOREQUAL, OP.VERIFY]),
    new Uint8Array([OP.DUP]),
    new Uint8Array([OP.TXWEIGHT]),
    pushInt(input.witnessBytes),
    new Uint8Array([OP.ADD]),
    pushInt(3),
    new Uint8Array([OP.ADD]),
    pushInt(4),
    new Uint8Array([OP.DIV]),
    pushInt(input.feerateCap),
    new Uint8Array([OP.MUL]),
    new Uint8Array([OP.LESSTHANOREQUAL, OP.VERIFY]),
    new Uint8Array([OP.DROP]),
  ]
  if (input.phone) {
    parts.push(
      pushInt(0),
      new Uint8Array([OP.SIGHASH]),
      pushData(new Uint8Array([DIRECT_P256_CSFS_PREFIX, ...input.phone])),
      new Uint8Array([OP.CHECKSIGFROMSTACK]),
    )
  } else {
    parts.push(pushInt(1))
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
  if (!scriptContains(script, pushInt(TRANSITION_OUTPUT_COUNT))) throw new Error('output count not pinned')
  if (!script.includes(OP.INSPECTPACKET)) throw new Error('packet not pinned')
  if (!scriptContains(script, pushInt(P2A_VALUE_SATS))) throw new Error('P2A value not pinned')
  // CSFS is only the last opcode. Dest programs can contain 0xcc.
  // Unbound scripts end in OP_1 so the emulator stack is exactly one true.
  const last = script.length > 0 ? script[script.length - 1] : 0
  const hasCsfs = last === OP.CHECKSIGFROMSTACK
  if (phoneBound !== hasCsfs) throw new Error('PhoneDirect bind mismatch')
  if (!phoneBound && last !== 0x51) throw new Error('unbound script must leave true on the stack')
}

export { concat }

import { hex } from '@scure/base'
import { p2tr } from '@scure/btc-signer'
import { vaultAddressNetwork } from './bitcoin'
import { bytesToHex, hexToBytes } from './hex'

// BIP341 NUMS, same internal key ark-lib UnspendableKey uses.
export const TAPROOT_NUMS_XONLY = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'

const OP_CHECKSIG = 0xac
const OP_CHECKSIGVERIFY = 0xad
const OP_CSV = 0xb2
const OP_DROP = 0x75
const OP_0 = 0x00
const OP_1 = 0x51

export function xOnlyFromCompressed(pub: string): Uint8Array {
  const raw = hexToBytes(pub)
  if (raw.length === 32) return raw
  if (raw.length === 33 && (raw[0] === 0x02 || raw[0] === 0x03)) return raw.slice(1)
  throw new Error('expected a compressed or x-only secp256k1 key')
}

export function encodeScriptInt(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw new Error('script integer out of range')
  }
  if (value === 0) return new Uint8Array([OP_0])
  if (value <= 16) return new Uint8Array([OP_1 + value - 1])
  const bytes: number[] = []
  let n = value
  while (n > 0) {
    bytes.push(n & 0xff)
    n >>= 8
  }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(0)
  return new Uint8Array([bytes.length, ...bytes])
}

export function checksigScript(pubs: Uint8Array[]): Uint8Array {
  if (pubs.length === 0) throw new Error('at least one key')
  const parts: number[] = []
  pubs.forEach((pub, i) => {
    if (pub.length !== 32) throw new Error('x-only key required')
    parts.push(0x20, ...pub)
    parts.push(i === pubs.length - 1 ? OP_CHECKSIG : OP_CHECKSIGVERIFY)
  })
  return new Uint8Array(parts)
}

export function csvChecksigScript(blocks: number, pub: Uint8Array): Uint8Array {
  const lock = encodeScriptInt(blocks)
  const key = checksigScript([pub])
  return new Uint8Array([...lock, OP_CSV, OP_DROP, ...key])
}

export interface SavingsTreeInput {
  phonePub: string
  hardwarePub: string
  phoneCsvBlocks: number
  hardwareCsvBlocks: number
  network: string
}

export function buildSavingsTree(input: SavingsTreeInput) {
  const phone = xOnlyFromCompressed(input.phonePub)
  const hardware = xOnlyFromCompressed(input.hardwarePub)
  if (hex.encode(phone) === hex.encode(hardware)) throw new Error('device and hardware keys must differ')
  if (input.phoneCsvBlocks < 1 || input.hardwareCsvBlocks < 1) throw new Error('csv delays required')

  const admin = checksigScript([phone, hardware])
  const phoneCsv = csvChecksigScript(input.phoneCsvBlocks, phone)
  const hardwareCsv = csvChecksigScript(input.hardwareCsvBlocks, hardware)
  // Same pairing as btcd AssembleTaprootScriptTree: (leaf0+leaf1) then +leaf2.
  const payment = p2tr(
    hex.decode(TAPROOT_NUMS_XONLY),
    [[{ script: admin }, { script: phoneCsv }], { script: hardwareCsv }],
    vaultAddressNetwork(input.network),
    true,
  )
  if (!payment.address || !payment.leaves) throw new Error('could not build savings tree')
  const leafOf = (script: Uint8Array) => {
    const leaf = payment.leaves!.find((item) => hex.encode(item.script) === hex.encode(script))
    if (!leaf) throw new Error('savings leaf missing from tree')
    return leaf
  }
  return {
    address: payment.address,
    script: payment.script,
    tapInternalKey: payment.tapInternalKey,
    tapLeafScript: payment.tapLeafScript,
    admin: leafOf(admin),
    phoneCsv: leafOf(phoneCsv),
    hardwareCsv: leafOf(hardwareCsv),
    phone,
    hardware,
  }
}

export function requireSavingsTreeMatchesAddress(input: SavingsTreeInput, expectedAddress: string) {
  const tree = buildSavingsTree(input)
  if (tree.address !== expectedAddress.trim()) {
    throw new Error('savings tree does not match this vault’s address')
  }
  return tree
}

export function describeSavingsLeaf(leaf: 'admin' | 'phoneCsv' | 'hardwareCsv') {
  if (leaf === 'admin') return 'this device + hardware'
  if (leaf === 'phoneCsv') return 'this device after the delay'
  return 'hardware after the delay'
}

export function hexLeafScript(script: Uint8Array): string {
  return bytesToHex(script)
}

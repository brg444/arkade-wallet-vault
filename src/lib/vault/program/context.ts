import { sha256 } from '@noble/hashes/sha2.js'
import { hex } from '@scure/base'
import { utils as btcUtils } from '@scure/btc-signer'
import { encodeUtf8 } from '../hex'
import { TAPROOT_NUMS_XONLY } from '../savingsTree'
import { CLAIMANTS, type Claimant, PROGRAM_INTERNAL_TAG, SAVINGS_TEMPLATE } from './constants'

export function taggedHash(tag: string, ...messages: Uint8Array[]): Uint8Array {
  const tagH = sha256(encodeUtf8(tag))
  const prefix = new Uint8Array(64)
  prefix.set(tagH, 0)
  prefix.set(tagH, 32)
  const total = messages.reduce((n, m) => n + m.length, 64)
  const out = new Uint8Array(total)
  out.set(prefix)
  let offset = 64
  for (const msg of messages) {
    out.set(msg, offset)
    offset += msg.length
  }
  return sha256(out)
}

function appendText(parts: Uint8Array[], value: string, name: string) {
  if (!value || value !== value.trim() || value !== value.toLowerCase()) {
    throw new Error(`${name} must be non-empty canonical lowercase`)
  }
  const bytes = encodeUtf8(value)
  const len = new Uint8Array(4)
  new DataView(len.buffer).setUint32(0, bytes.length, false)
  parts.push(len, bytes)
}

export function encodeTreeContext(input: {
  vaultId: string
  claimant?: Claimant | ''
  templateVersion?: string
}): Uint8Array {
  const claimant = input.claimant || ''
  if (claimant && !CLAIMANTS.includes(claimant as Claimant)) throw new Error('unknown claimant')
  const parts: Uint8Array[] = []
  appendText(parts, input.vaultId, 'vaultId')
  appendText(parts, 'savings', 'kind')
  appendText(parts, claimant === '' ? '-' : claimant, 'claimant')
  appendText(parts, input.templateVersion || SAVINGS_TEMPLATE, 'templateVersion')
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** BIP341 TapTweak of the NUMS point with a context hash. Always a valid x-only. */
export function contextInternalKey(input: {
  vaultId: string
  claimant?: Claimant | ''
  templateVersion?: string
}): Uint8Array {
  const context = taggedHash(PROGRAM_INTERNAL_TAG, encodeTreeContext(input))
  const [tweaked] = btcUtils.taprootTweakPubkey(hex.decode(TAPROOT_NUMS_XONLY), context)
  return tweaked
}

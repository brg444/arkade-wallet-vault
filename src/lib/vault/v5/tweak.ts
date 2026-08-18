import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { xOnlyFromCompressed } from '../savingsTree'

export const ARK_SCRIPT_HASH_TAG = 'ArkScriptHash'

export function arkadeScriptHash(script: Uint8Array): Uint8Array {
  return schnorr.utils.taggedHash(ARK_SCRIPT_HASH_TAG, script)
}

/** even-Y(base) + TaggedHash("ArkScriptHash", script)·G, compressed. */
export function tweakByArkScript(basePub: string, script: Uint8Array): string {
  const xonly = xOnlyFromCompressed(basePub)
  const hash = arkadeScriptHash(script)
  const evenY = secp256k1.Point.fromBytes(new Uint8Array([0x02, ...xonly]))
  const scalar = BigInt(`0x${hex.encode(hash)}`)
  if (scalar === 0n) throw new Error('ArkScriptHash is zero')
  const tweaked = evenY.add(secp256k1.Point.BASE.multiply(scalar))
  if (tweaked.equals(secp256k1.Point.ZERO)) throw new Error('Arkade tweak is degenerate')
  return hex.encode(tweaked.toBytes(true))
}

export function tweakPair(
  vaultBase: string,
  arkadeBase: string,
  script: Uint8Array,
): { vault: string; arkade: string } {
  return {
    vault: tweakByArkScript(vaultBase, script),
    arkade: tweakByArkScript(arkadeBase, script),
  }
}

/** even-Y(base scalar) + ArkScriptHash, 32-byte secret. */
export function tweakPrivateKey(secret: Uint8Array, script: Uint8Array): Uint8Array {
  if (secret.length !== 32) throw new Error('secret must be 32 bytes')
  const pub = secp256k1.getPublicKey(secret, true)
  const n = secp256k1.Point.CURVE().n
  let d = BigInt(`0x${hex.encode(secret)}`)
  if (pub[0] === 0x03) d = n - d
  const t = BigInt(`0x${hex.encode(arkadeScriptHash(script))}`)
  const sum = (d + t) % n
  if (sum === 0n) throw new Error('Arkade tweak is degenerate')
  return hex.decode(sum.toString(16).padStart(64, '0'))
}

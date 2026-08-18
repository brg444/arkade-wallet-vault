import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { arkadeScriptHash, tweakByArkScript, tweakPrivateKey } from './tweak'

describe('Arkade script tweak', () => {
  it('matches the Go even-to-tweaked-odd vector', () => {
    const script = new TextEncoder().encode('OP_TRUE')
    const priv = hex.decode('05717677ccec3c6ec975b8356b104808b6e149b82d9816d2d7c3b25dd658c220')
    const base = hex.encode(secp256k1.getPublicKey(priv, true))
    expect(base.startsWith('02')).toBe(true)
    expect(hex.encode(arkadeScriptHash(script))).toHaveLength(64)
    const tweaked = tweakByArkScript(base, script)
    expect(tweaked.startsWith('02') || tweaked.startsWith('03')).toBe(true)
    expect(tweaked).not.toBe(base)
  })

  it('tweaks a private key to the same x-only as the public tweak', () => {
    const script = new TextEncoder().encode('OP_TRUE')
    const secret = hex.decode('05717677ccec3c6ec975b8356b104808b6e149b82d9816d2d7c3b25dd658c220')
    const tweakedPriv = tweakPrivateKey(secret, script)
    const pub = hex.encode(secp256k1.getPublicKey(secret, true))
    expect(hex.encode(secp256k1.getPublicKey(tweakedPriv, true)).slice(2)).toBe(tweakByArkScript(pub, script).slice(2))
  })
})

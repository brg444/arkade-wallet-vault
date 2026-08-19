import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { P2A_SCRIPT_HEX, TRANSITION_SEQUENCE } from './constants'
import {
  DIRECT_P256_CSFS_PREFIX,
  OP,
  TRANSITION_WITNESS_BYTES,
  assertTransitionScript,
  buildTransitionScript,
  pushInt,
  scriptContains,
} from './script'

const DEST = '5120aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER = '5120bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const PHONE_DIRECT = hex.decode('036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296')

describe('staged transition auth script', () => {
  it('pins dest, P2A, and the RBF sequence without PhoneDirect', () => {
    const script = buildTransitionScript({ destScriptHex: DEST })
    assertTransitionScript(script, DEST, false)
    expect(scriptContains(script, hex.decode('4e73'))).toBe(true)
    expect(scriptContains(script, pushInt(TRANSITION_SEQUENCE))).toBe(true)
    expect(scriptContains(script, pushInt(0xffffffff))).toBe(false)
    expect(script.includes(OP.CHECKSIGFROMSTACK)).toBe(false)
    expect(script.includes(OP.MUL)).toBe(true)
    expect(scriptContains(script, pushInt(3))).toBe(true)
    expect(script.includes(OP.INSPECTPACKET)).toBe(true)
    expect(scriptContains(script, pushInt(TRANSITION_WITNESS_BYTES))).toBe(true)
    expect(P2A_SCRIPT_HEX.endsWith('4e73')).toBe(true)
  })

  it('binds PhoneDirect CSFS only when asked', () => {
    const phone = buildTransitionScript({ destScriptHex: DEST, bindPhoneDirect: PHONE_DIRECT })
    const hardware = buildTransitionScript({ destScriptHex: DEST })
    assertTransitionScript(phone, DEST, true)
    assertTransitionScript(hardware, DEST, false)
    expect(scriptContains(phone, new Uint8Array([DIRECT_P256_CSFS_PREFIX, ...PHONE_DIRECT]))).toBe(true)
    expect(hardware.includes(OP.CHECKSIGFROMSTACK)).toBe(false)
    expect(scriptContains(hardware, PHONE_DIRECT)).toBe(false)
  })

  it('refuses a dest that is not p2tr', () => {
    expect(() => buildTransitionScript({ destScriptHex: '0014aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })).toThrow(
      /p2tr/,
    )
  })

  it('refuses a non-compressed PhoneDirect key', () => {
    expect(() => buildTransitionScript({ destScriptHex: DEST, bindPhoneDirect: new Uint8Array(32) })).toThrow(
      /33 bytes/,
    )
    expect(() => buildTransitionScript({ destScriptHex: DEST, bindPhoneDirect: new Uint8Array(33) })).toThrow(
      /compressed/,
    )
    const offCurve = hex.decode('02' + '11'.repeat(32))
    expect(() => buildTransitionScript({ destScriptHex: DEST, bindPhoneDirect: offCurve })).toThrow(/off-curve/)
  })

  it('rejects dest or bind mismatches', () => {
    const script = buildTransitionScript({ destScriptHex: DEST })
    expect(() => assertTransitionScript(script, OTHER, false)).toThrow(/dest program not pinned/)
    expect(() => assertTransitionScript(script, DEST, true)).toThrow(/PhoneDirect bind mismatch/)
    const phone = buildTransitionScript({ destScriptHex: DEST, bindPhoneDirect: PHONE_DIRECT })
    expect(() => assertTransitionScript(phone, DEST, false)).toThrow(/PhoneDirect bind mismatch/)
  })

  it('is deterministic and dest-specific', () => {
    const a = buildTransitionScript({ destScriptHex: DEST })
    const b = buildTransitionScript({ destScriptHex: DEST })
    const c = buildTransitionScript({ destScriptHex: OTHER })
    expect(hex.encode(a)).toBe(hex.encode(b))
    expect(hex.encode(a)).not.toBe(hex.encode(c))
    expect(hex.encode(a).length).toBeGreaterThan(80)
  })

  it('does not treat a dest program byte 0xcc as PhoneDirect', () => {
    const dest = `5120${'cc'.repeat(32)}`
    const script = buildTransitionScript({ destScriptHex: dest })
    assertTransitionScript(script, dest, false)
    expect(script[script.length - 1]).toBe(0x51)
  })
})

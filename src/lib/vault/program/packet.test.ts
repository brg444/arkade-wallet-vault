import { describe, expect, it } from 'vitest'
import {
  EMULATOR_PACKET_TYPE,
  encodeEmulatorPacket,
  encodeEmulatorPacketMasked,
  encodeExtensionScript,
  exactPacketOutputPrefix,
  packetWitnessShape,
  parseEmulatorPacket,
} from './packet'

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('Savings transition packet envelope', () => {
  it('prefix plus content reconstructs the extension script', () => {
    const scriptLen = 180
    const prefix = exactPacketOutputPrefix(scriptLen, packetWitnessShape(false))
    const content = encodeEmulatorPacket({
      vin: 0,
      script: new Uint8Array(scriptLen),
      witness: [],
    })
    const full = encodeExtensionScript([{ type: EMULATOR_PACKET_TYPE, data: content }])
    const rebuilt = new Uint8Array(prefix.length + content.length)
    rebuilt.set(prefix)
    rebuilt.set(content, prefix.length)
    expect(Array.from(rebuilt)).toEqual(Array.from(full))
    expect(prefix.length).toBeGreaterThan(4)
  })

  it('phone witness shape changes the prefix', () => {
    const a = exactPacketOutputPrefix(180, packetWitnessShape(false))
    const b = exactPacketOutputPrefix(180, packetWitnessShape(true))
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  it('round-trips empty and direct-signature witnesses using the Operator wire format', () => {
    const script = Uint8Array.from([0xaa, 0xbb])
    const empty = encodeEmulatorPacket({ vin: 0, script, witness: [] })
    expect(hex(empty)).toBe('01000002aabb0100')
    expect(parseEmulatorPacket(empty)).toEqual({ vin: 0, script, witness: [] })
    expect(hex(encodeEmulatorPacketMasked({ vin: 0, script }))).toBe('01000002aabb00')

    const signature = new Uint8Array(64).fill(0x11)
    const signed = encodeEmulatorPacket({ vin: 0, script, witness: [signature] })
    expect(parseEmulatorPacket(signed)).toEqual({ vin: 0, script, witness: [signature] })
  })
})

import { describe, expect, it } from 'vitest'
import {
  encodeEmulatorPacket,
  encodeEmulatorPacketMasked,
  parseEmulatorPacket,
} from './psbtcheck.js'

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('emulator packet wire encoding', () => {
  it('round-trips an empty witness the way Go WriteTxWitness does', () => {
    const script = Uint8Array.from([0xaa, 0xbb])
    const encoded = encodeEmulatorPacket({ vin: 0, script, witness: [] })
    // count=1, vin=0, script_len=2, aabb, witness_len=1, WriteTxWitness([])=0x00
    expect(hex(encoded)).toBe('01000002aabb0100')
    const parsed = parseEmulatorPacket(encoded)
    expect(parsed.vin).toBe(0)
    expect(hex(parsed.script)).toBe('aabb')
    expect(parsed.witness).toEqual([])
    expect(hex(encodeEmulatorPacket(parsed))).toBe(hex(encoded))
  })

  it('keeps the sighash-masked encoding at witness_len 0', () => {
    const script = Uint8Array.from([0xaa, 0xbb])
    expect(hex(encodeEmulatorPacketMasked({ vin: 0, script }))).toBe('01000002aabb00')
  })

  it('round-trips a one-item direct signature witness', () => {
    const script = Uint8Array.from([0xaa, 0xbb])
    const sig = new Uint8Array(64).fill(0x11)
    const encoded = encodeEmulatorPacket({ vin: 0, script, witness: [sig] })
    const parsed = parseEmulatorPacket(encoded)
    expect(parsed.witness).toHaveLength(1)
    expect(hex(parsed.witness[0])).toBe(hex(sig))
    expect(hex(encodeEmulatorPacket(parsed))).toBe(hex(encoded))
  })
})

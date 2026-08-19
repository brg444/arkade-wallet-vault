import { describe, expect, it } from 'vitest'
import { encodeEmulatorPacket, encodeExtensionScript } from '../ceremony/psbtcheck.js'
import { EMULATOR_PACKET_TYPE, exactPacketOutputPrefix, packetWitnessShape } from './packet'

describe('staged packet envelope', () => {
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
})

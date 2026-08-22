import { encodeEmulatorPacket, encodeExtensionScript, PACKET_TYPE } from '../ceremony/psbtcheck.js'

export const EMULATOR_PACKET_TYPE = PACKET_TYPE as number

export function exactPacketOutputPrefix(scriptLen: number, witnessItemLens: number[]): Uint8Array {
  if (scriptLen <= 0) throw new Error('authorization script length required')
  const content = encodeEmulatorPacket({
    vin: 0,
    script: new Uint8Array(scriptLen),
    witness: witnessItemLens.map((len) => new Uint8Array(len)),
  })
  const outputScript = encodeExtensionScript([{ type: EMULATOR_PACKET_TYPE, data: content }])
  if (outputScript.length <= content.length) throw new Error('canonical packet output envelope')
  const prefix = outputScript.slice(0, outputScript.length - content.length)
  for (let i = 0; i < content.length; i++) {
    if (outputScript[prefix.length + i] !== content[i]) throw new Error('canonical packet output envelope')
  }
  return prefix
}

export function packetWitnessShape(phoneBound: boolean): number[] {
  return phoneBound ? [64] : []
}

export function emulatorPacketScript(authScript: Uint8Array, phoneBound: boolean, phoneSig?: Uint8Array): Uint8Array {
  const witness = phoneBound ? [phoneSig ?? new Uint8Array(64)] : []
  if (phoneBound && witness[0].length !== 64) throw new Error('PhoneDirect signature must be 64 bytes')
  return encodeExtensionScript([
    {
      type: EMULATOR_PACKET_TYPE,
      data: encodeEmulatorPacket({ vin: 0, script: authScript, witness }),
    },
  ])
}

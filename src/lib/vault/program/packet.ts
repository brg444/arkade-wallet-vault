const ARK_MAGIC = Uint8Array.of(0x41, 0x52, 0x4b)

export const EMULATOR_PACKET_TYPE = 0x01

export type EmulatorPacket = {
  vin: number
  script: Uint8Array
  witness: Uint8Array[]
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function writeCompactSize(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('compact size')
  if (value < 0xfd) return Uint8Array.of(value)
  if (value <= 0xffff) return Uint8Array.of(0xfd, value & 0xff, (value >> 8) & 0xff)
  if (value <= 0xffffffff) {
    return Uint8Array.of(0xfe, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff)
  }
  throw new Error('compact size too large')
}

function readCompactSize(bytes: Uint8Array, offset: number): [bigint, number] {
  if (offset >= bytes.length) throw new Error('truncated compact size')
  const first = bytes[offset]
  if (first < 0xfd) return [BigInt(first), offset + 1]
  if (first === 0xfd) {
    if (offset + 3 > bytes.length) throw new Error('truncated compact size')
    return [BigInt(bytes[offset + 1] | (bytes[offset + 2] << 8)), offset + 3]
  }
  if (first === 0xfe) {
    if (offset + 5 > bytes.length) throw new Error('truncated compact size')
    return [
      BigInt(bytes[offset + 1]) |
        (BigInt(bytes[offset + 2]) << 8n) |
        (BigInt(bytes[offset + 3]) << 16n) |
        (BigInt(bytes[offset + 4]) << 24n),
      offset + 5,
    ]
  }
  throw new Error('oversized compact size')
}

function boundedNumber(value: bigint, max: number, label: string): number {
  if (value < 0n || value > BigInt(max) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds remaining input`)
  }
  return Number(value)
}

function writeWitness(items: Uint8Array[]): Uint8Array {
  return concat([writeCompactSize(items.length), ...items.flatMap((item) => [writeCompactSize(item.length), item])])
}

function readWitness(bytes: Uint8Array): Uint8Array[] {
  let offset = 0
  const [rawCount, next] = readCompactSize(bytes, offset)
  offset = next
  const count = boundedNumber(rawCount, bytes.length, 'witness item count')
  const items: Uint8Array[] = []
  for (let i = 0; i < count; i++) {
    const [rawLength, afterLength] = readCompactSize(bytes, offset)
    offset = afterLength
    const length = boundedNumber(rawLength, bytes.length - offset, 'witness item length')
    if (offset + length > bytes.length) throw new Error('truncated witness item')
    items.push(bytes.slice(offset, offset + length))
    offset += length
  }
  if (offset !== bytes.length) throw new Error('unexpected witness trailer')
  return items
}

function writeUvarint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('uvarint')
  const out: number[] = []
  let remaining = BigInt(value)
  while (remaining >= 0x80n) {
    out.push(Number((remaining & 0x7fn) | 0x80n))
    remaining >>= 7n
  }
  out.push(Number(remaining))
  return Uint8Array.from(out)
}

function pushBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 76) return concat([Uint8Array.of(bytes.length), bytes])
  if (bytes.length <= 0xff) return concat([Uint8Array.of(0x4c, bytes.length), bytes])
  if (bytes.length <= 0xffff) {
    return concat([Uint8Array.of(0x4d, bytes.length & 0xff, (bytes.length >> 8) & 0xff), bytes])
  }
  throw new Error('push too large')
}

export function encodeExtensionScript(packets: { type: number; data: Uint8Array }[]): Uint8Array {
  if (packets.length === 0) throw new Error('missing packets')
  const seen = new Set<number>()
  const body: Uint8Array[] = [ARK_MAGIC]
  for (const packet of packets) {
    if (!Number.isSafeInteger(packet.type) || packet.type < 0 || packet.type > 0xff) throw new Error('packet type')
    if (seen.has(packet.type)) throw new Error('duplicate packet type')
    seen.add(packet.type)
    body.push(Uint8Array.of(packet.type), writeUvarint(packet.data.length), packet.data)
  }
  return concat([Uint8Array.of(0x6a), pushBytes(concat(body))])
}

export function encodeEmulatorPacket(entry: EmulatorPacket): Uint8Array {
  if (!Number.isSafeInteger(entry.vin) || entry.vin < 0 || entry.vin > 0xffff) throw new Error('emulator vin')
  const witness = writeWitness(entry.witness)
  return concat([
    writeCompactSize(1),
    Uint8Array.of(entry.vin & 0xff, (entry.vin >> 8) & 0xff),
    writeCompactSize(entry.script.length),
    entry.script,
    writeCompactSize(witness.length),
    witness,
  ])
}

export function encodeEmulatorPacketMasked(entry: Pick<EmulatorPacket, 'vin' | 'script'>): Uint8Array {
  if (!Number.isSafeInteger(entry.vin) || entry.vin < 0 || entry.vin > 0xffff) throw new Error('emulator vin')
  return concat([
    writeCompactSize(1),
    Uint8Array.of(entry.vin & 0xff, (entry.vin >> 8) & 0xff),
    writeCompactSize(entry.script.length),
    entry.script,
    writeCompactSize(0),
  ])
}

export function parseEmulatorPacket(bytes: Uint8Array): EmulatorPacket {
  let offset = 0
  const [count, afterCount] = readCompactSize(bytes, offset)
  offset = afterCount
  if (count !== 1n) throw new Error('exactly one emulator entry required')
  if (offset + 2 > bytes.length) throw new Error('truncated emulator vin')
  const vin = bytes[offset] | (bytes[offset + 1] << 8)
  offset += 2
  const [rawScriptLength, afterScriptLength] = readCompactSize(bytes, offset)
  offset = afterScriptLength
  const scriptLength = boundedNumber(rawScriptLength, bytes.length - offset, 'emulator script length')
  if (offset + scriptLength > bytes.length) throw new Error('truncated emulator script')
  const script = bytes.slice(offset, offset + scriptLength)
  offset += scriptLength
  const [rawWitnessLength, afterWitnessLength] = readCompactSize(bytes, offset)
  offset = afterWitnessLength
  const witnessLength = boundedNumber(rawWitnessLength, bytes.length - offset, 'emulator witness length')
  if (offset + witnessLength > bytes.length) throw new Error('truncated emulator witness')
  const witnessBytes = bytes.slice(offset, offset + witnessLength)
  offset += witnessLength
  if (offset !== bytes.length) throw new Error('unexpected emulator packet trailer')
  return { vin, script, witness: witnessLength === 0 ? [] : readWitness(witnessBytes) }
}

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

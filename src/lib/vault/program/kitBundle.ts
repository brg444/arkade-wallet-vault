import { kitHasUnlock, type RecoveryKit } from './kit'

export const RECOVERY_GUIDE = `Vaulted emergency recovery
Keep this note with Recovery Kit.json.

If the Vaulted app still works, open it and use Recovery. Stop here.

If it does not:
1. On the phone that created the vault, open the same website you enrolled on.
2. Choose Open a Recovery Kit, pick Recovery Kit.json, then Face ID.
3. Ordinary savings still need this phone and your hardware. The file is not a seed.

If that website is gone, use the Vaulted emergency recovery page you already trust.
Double-click Recover.command (Mac). Then choose this kit. Face ID only works if
the browser is using the website name you originally enrolled on.

This file cannot replace a deleted passkey or lost hardware.
`

function titleTier(tier: string): string {
  return tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : 'Vault'
}

function siteLabel(kit: RecoveryKit): string {
  return (kit.rpId || 'vaulted').replace(/[^a-z0-9.-]+/gi, '-')
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return crc ^ 0xffffffff
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, true)
  return out
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function zipUtf8(files: { name: string; text: string }[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = encoder.encode(file.text)
    const crc = crc32(data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ])
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ])
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const center = concat(centrals)
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(center.length),
    u32(offset),
    u16(0),
  ])
  return concat([...locals, center, end])
}

export function recoveryKitLabel(kit: RecoveryKit): string {
  const site = kit.rpId || 'unknown site'
  const unlock = kitHasUnlock(kit) ? 'Face ID ready' : 'map only'
  return `${titleTier(kit.protectionTier)} · ${kit.descriptor.network} · ${site} · ${unlock}`
}

export function recoveryKitArchiveName(kit: RecoveryKit, now = new Date()): string {
  const day = now.toISOString().slice(0, 10)
  return `Vaulted Recovery ${day} ${titleTier(kit.protectionTier)} ${siteLabel(kit)}.zip`
}

export function packRecoveryKit(kit: RecoveryKit, now = new Date()): { filename: string; bytes: Uint8Array; blob: Blob } {
  const json = `${JSON.stringify(kit, null, 2)}\n`
  const bytes = zipUtf8([
    { name: 'Recovery Kit.json', text: json },
    { name: 'How to recover.txt', text: RECOVERY_GUIDE },
  ])
  return {
    filename: recoveryKitArchiveName(kit, now),
    bytes,
    blob: new Blob([bytes as BlobPart], { type: 'application/zip' }),
  }
}

export function extractRecoveryKitJson(bytes: Uint8Array): string {
  if (!bytes.length) throw new Error('That file is empty')
  const asJson = jsonIfLooksLikeKit(bytes)
  if (asJson) return asJson
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('Choose Recovery Kit.json or the zip you saved from Vaulted')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  let offset = 0
  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true)
    if (signature !== 0x04034b50) break
    const method = view.getUint16(offset + 8, true)
    const compressed = view.getUint32(offset + 18, true)
    const uncompressed = view.getUint32(offset + 22, true)
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const nameStart = offset + 30
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength))
    const dataStart = nameStart + nameLength + extraLength
    const size = method === 0 ? uncompressed : compressed
    const data = bytes.subarray(dataStart, dataStart + size)
    if (isKitJsonName(name)) {
      if (method !== 0) throw new Error('Open the zip, then choose Recovery Kit.json')
      const json = jsonIfLooksLikeKit(data)
      if (!json) throw new Error('That zip does not contain a Recovery Kit')
      return json
    }
    offset = dataStart + size
  }
  throw new Error('That zip does not contain Recovery Kit.json')
}

export function downloadBlob(filename: string, blob: Blob) {
  const hidden = document.createElement('a')
  hidden.href = URL.createObjectURL(blob)
  hidden.download = filename
  document.body.appendChild(hidden)
  hidden.click()
  hidden.remove()
  setTimeout(() => URL.revokeObjectURL(hidden.href), 1_000)
}

export function saveRecoveryKitArchive(kit: RecoveryKit) {
  const packed = packRecoveryKit(kit)
  downloadBlob(packed.filename, packed.blob)
}

function jsonIfLooksLikeKit(bytes: Uint8Array): string | null {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trim()
  return text.startsWith('{') ? text : null
}

function isKitJsonName(name: string): boolean {
  const base = name.split('/').pop() || name
  return base === 'Recovery Kit.json' || base.toLowerCase() === 'recovery kit.json'
}

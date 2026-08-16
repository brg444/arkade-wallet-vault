export function requireLowerHex(value: string, name: string, exactBytes?: number): string {
  if (!value || value !== value.toLowerCase() || value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) {
    throw new Error(`${name} must be canonical lowercase hex`)
  }
  if (exactBytes !== undefined && value.length !== exactBytes * 2) {
    throw new Error(`${name} must be ${exactBytes} bytes`)
  }
  return value
}

export function hexToBytes(value: string): Uint8Array {
  const hex = requireLowerHex(value, 'hex')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function fingerprint(hex: string, size = 4): string {
  if (!hex) return '—'
  const compact = hex.toLowerCase()
  if (compact.length <= size * 4) return compact
  return `${compact.slice(0, size * 2)}…${compact.slice(-size * 2)}`
}

export function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

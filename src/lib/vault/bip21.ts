import { ArkAddress } from '@arkade-os/sdk'

const SATOSHIS_PER_BITCOIN = 100_000_000n

export interface VaultBip21 {
  bitcoinAddress: string
  arkadeAddress?: string
  satoshis?: number
  lightning?: string
}

function parseBitcoinAmount(value: string): number {
  if (!/^\d+(?:\.\d{1,8})?$/.test(value)) throw new Error('invalid BIP21 amount')

  const [whole, fraction = ''] = value.split('.')
  const satoshis = BigInt(whole) * SATOSHIS_PER_BITCOIN + BigInt(fraction.padEnd(8, '0'))
  if (satoshis > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('BIP21 amount is too large')
  return Number(satoshis)
}

function formatBitcoinAmount(satoshis: number): string {
  if (!Number.isSafeInteger(satoshis) || satoshis < 0) throw new Error('invalid satoshi amount')

  const value = BigInt(satoshis)
  const whole = value / SATOSHIS_PER_BITCOIN
  const fraction = (value % SATOSHIS_PER_BITCOIN).toString().padStart(8, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function validArkadeAddress(value: string): boolean {
  try {
    ArkAddress.decode(value)
    return true
  } catch {
    return false
  }
}

export function decodeVaultBip21(value: string): VaultBip21 {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith('bitcoin:')) throw new Error('invalid BIP21 URI')

  const [addressPart, query = ''] = trimmed.slice(8).split('?', 2)
  const bitcoinAddress = decodeURIComponent(addressPart)
  const params = new URLSearchParams(query)
  for (const key of params.keys()) {
    if (key.toLowerCase().startsWith('req-')) throw new Error(`unsupported required BIP21 parameter: ${key}`)
  }

  const arkadeAddress = params.get('ark')?.trim() || undefined
  if (arkadeAddress && !validArkadeAddress(arkadeAddress)) throw new Error('invalid Arkade address')

  const amount = params.get('amount')
  const lightning = params.get('lightning')?.trim() || undefined
  return {
    bitcoinAddress,
    ...(arkadeAddress ? { arkadeAddress } : {}),
    ...(amount === null ? {} : { satoshis: parseBitcoinAmount(amount) }),
    ...(lightning ? { lightning } : {}),
  }
}

export function isVaultBip21(value: string): boolean {
  try {
    decodeVaultBip21(value)
    return true
  } catch {
    return false
  }
}

export function encodeVaultBip21({
  bitcoinAddress,
  arkadeAddress,
  satoshis,
  lightning,
}: {
  bitcoinAddress: string
  arkadeAddress: string
  satoshis?: number
  lightning?: string
}): string {
  const params = new URLSearchParams({ ark: arkadeAddress })
  if (lightning) params.set('lightning', lightning)
  if (satoshis) params.set('amount', formatBitcoinAmount(satoshis))
  return `bitcoin:${bitcoinAddress}?${params.toString()}`
}

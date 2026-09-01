import { fromSatoshis, prettyFiatAmount } from '../format'
import type { Fiats } from '../types'

export interface VaultFiatDisplayRate {
  currency: Fiats
  pricePerBtc: number
}

export function approximateFiatLabel(sats: number, rate?: VaultFiatDisplayRate | null): string {
  if (!rate || !Number.isFinite(rate.pricePerBtc) || rate.pricePerBtc <= 0) return ''
  return `approximately ${prettyFiatAmount(fromSatoshis(sats) * rate.pricePerBtc, rate.currency)}`
}

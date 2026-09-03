import { fromSatoshis, prettyFiatAmount, prettyNumber } from '../format'
import type { Fiats } from '../types'

export type VaultBalanceUnit = 'sats' | 'usd'

export interface VaultFiatDisplayRate {
  currency: Fiats
  pricePerBtc: number
}

export function usdFromSats(sats: number, usdPerBtc: number): number {
  if (!Number.isFinite(sats) || !Number.isFinite(usdPerBtc) || usdPerBtc <= 0) return 0
  return fromSatoshis(sats) * usdPerBtc
}

export function homeBalanceDisplay(
  sats: number,
  unit: VaultBalanceUnit,
  rate?: VaultFiatDisplayRate | null,
): { amount: string; unit: string; label: string } {
  if (unit === 'usd' && rate && Number.isFinite(rate.pricePerBtc) && rate.pricePerBtc > 0) {
    const amount = prettyFiatAmount(usdFromSats(sats, rate.pricePerBtc), rate.currency)
    return { amount, unit: '', label: amount }
  }
  const amount = `₿${prettyNumber(sats)}`
  return { amount, unit: '', label: amount }
}

export function approximateFiatLabel(sats: number, rate?: VaultFiatDisplayRate | null): string {
  if (!rate || !Number.isFinite(rate.pricePerBtc) || rate.pricePerBtc <= 0) return ''
  return `approximately ${prettyFiatAmount(fromSatoshis(sats) * rate.pricePerBtc, rate.currency)}`
}

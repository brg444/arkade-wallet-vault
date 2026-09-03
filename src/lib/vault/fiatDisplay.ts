import { fromSatoshis, prettyFiatAmount, prettyNumber } from '../format'
import { Fiats } from '../types'

export const DISPLAY_USD_PER_BTC = 100_000

export type VaultBalanceUnit = 'sats' | 'usd'

export interface VaultFiatDisplayRate {
  currency: Fiats
  pricePerBtc: number
}

export function usdFromSatsAtDisplayRate(sats: number, usdPerBtc = DISPLAY_USD_PER_BTC): number {
  if (!Number.isFinite(sats) || !Number.isFinite(usdPerBtc) || usdPerBtc <= 0) return 0
  return fromSatoshis(sats) * usdPerBtc
}

export function homeBalanceDisplay(
  sats: number,
  unit: VaultBalanceUnit,
): { amount: string; unit: string; label: string } {
  if (unit === 'usd') {
    const amount = prettyFiatAmount(usdFromSatsAtDisplayRate(sats), Fiats.USD)
    return { amount, unit: '', label: amount }
  }
  const amount = `₿${prettyNumber(sats)}`
  return { amount, unit: '', label: amount }
}

export function approximateFiatLabel(sats: number, rate?: VaultFiatDisplayRate | null): string {
  if (!rate || !Number.isFinite(rate.pricePerBtc) || rate.pricePerBtc <= 0) return ''
  return `approximately ${prettyFiatAmount(fromSatoshis(sats) * rate.pricePerBtc, rate.currency)}`
}

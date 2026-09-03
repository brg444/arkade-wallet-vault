import { describe, expect, it } from 'vitest'
import { Fiats } from '../types'
import { approximateFiatLabel, homeBalanceDisplay, usdFromSatsAtDisplayRate } from './fiatDisplay'

describe('vault fiat display', () => {
  it('formats an approximate display value without changing satoshi amounts', () => {
    expect(approximateFiatLabel(50_000, { currency: Fiats.USD, pricePerBtc: 100_000 })).toBe('approximately $50.00')
    expect(approximateFiatLabel(50_000, null)).toBe('')
    expect(approximateFiatLabel(50_000, { currency: Fiats.USD, pricePerBtc: Number.NaN })).toBe('')
  })

  it('converts sats at the $100,000 per bitcoin display rate', () => {
    expect(usdFromSatsAtDisplayRate(100_000_000)).toBe(100_000)
    expect(usdFromSatsAtDisplayRate(50_000)).toBe(50)
    expect(usdFromSatsAtDisplayRate(1_000)).toBe(1)
  })

  it('formats the Home hero as ₿sats or USD at $100,000 per bitcoin', () => {
    expect(homeBalanceDisplay(10_000, 'sats')).toEqual({
      amount: '₿10,000',
      unit: '',
      label: '₿10,000',
    })
    expect(homeBalanceDisplay(128_000, 'sats')).toEqual({
      amount: '₿128,000',
      unit: '',
      label: '₿128,000',
    })
    expect(homeBalanceDisplay(128_000, 'usd')).toEqual({
      amount: '$128.00',
      unit: '',
      label: '$128.00',
    })
    expect(homeBalanceDisplay(100_000_000, 'usd').amount).toBe('$100,000.00')
  })
})

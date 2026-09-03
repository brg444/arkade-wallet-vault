import { describe, expect, it } from 'vitest'
import { Fiats } from '../types'
import { approximateFiatLabel, homeBalanceDisplay, usdFromSats } from './fiatDisplay'

describe('vault fiat display', () => {
  it('formats an approximate display value without changing satoshi amounts', () => {
    expect(approximateFiatLabel(50_000, { currency: Fiats.USD, pricePerBtc: 100_000 })).toBe('approximately $50.00')
    expect(approximateFiatLabel(50_000, null)).toBe('')
    expect(approximateFiatLabel(50_000, { currency: Fiats.USD, pricePerBtc: Number.NaN })).toBe('')
  })

  it('converts sats using the supplied USD price', () => {
    expect(usdFromSats(100_000_000, 125_000)).toBe(125_000)
    expect(usdFromSats(50_000, 125_000)).toBe(62.5)
    expect(usdFromSats(1_000, 125_000)).toBe(1.25)
  })

  it('formats the Home hero as ₿sats or USD using the live display rate', () => {
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
    expect(homeBalanceDisplay(128_000, 'usd', { currency: Fiats.USD, pricePerBtc: 125_000 })).toEqual({
      amount: '$160.00',
      unit: '',
      label: '$160.00',
    })
    expect(homeBalanceDisplay(100_000_000, 'usd', { currency: Fiats.USD, pricePerBtc: 125_000 }).amount).toBe(
      '$125,000.00',
    )
  })

  it('falls back to sats when a USD rate is unavailable or invalid', () => {
    expect(homeBalanceDisplay(128_000, 'usd', null).amount).toBe('₿128,000')
    expect(homeBalanceDisplay(128_000, 'usd', { currency: Fiats.USD, pricePerBtc: Number.NaN }).amount).toBe('₿128,000')
  })
})

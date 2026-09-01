import { describe, expect, it } from 'vitest'
import { Fiats } from '../types'
import { approximateFiatLabel } from './fiatDisplay'

describe('vault fiat display', () => {
  it('formats an approximate display value without changing satoshi amounts', () => {
    expect(approximateFiatLabel(50_000, { currency: Fiats.USD, pricePerBtc: 100_000 })).toBe('approximately $50.00')
    expect(approximateFiatLabel(50_000, null)).toBe('')
    expect(approximateFiatLabel(50_000, { currency: Fiats.USD, pricePerBtc: Number.NaN })).toBe('')
  })
})

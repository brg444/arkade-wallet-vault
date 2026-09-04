import { describe, expect, it } from 'vitest'
import { ABSOLUTE_FEE_CEILING_SATS, FEERATE_CEILING_SAT_PER_V } from './constants'
import {
  operationalOnchainFeeSats,
  satPerVFromFeeEstimates,
  SAVINGS_CLAIM_VBYTES,
  SAVINGS_TRANSITION_VBYTES,
} from './onchainFee'

describe('operational onchain fees', () => {
  it('picks the first estimate at or above the confirmation target', () => {
    expect(satPerVFromFeeEstimates({ 1: 8, 3: 2.2, 6: 1 })).toBe(2.2)
    expect(satPerVFromFeeEstimates({ 1: 8, 2: 5 })).toBe(5)
  })

  it('pays mempool feerate under the enrolled ceilings', () => {
    expect(
      operationalOnchainFeeSats({
        vbytes: 400,
        satPerV: 1.2,
        feerateCapSatPerV: 25,
        absoluteFeeCapSats: 20_000,
      }),
    ).toBe(800)
  })

  it('clamps a mempool spike to the enrolled feerate cap', () => {
    expect(
      operationalOnchainFeeSats({
        vbytes: 400,
        satPerV: 80,
        feerateCapSatPerV: 25,
        absoluteFeeCapSats: 20_000,
      }),
    ).toBe(10_000)
  })

  it('clamps an oversized vbyte quote to the absolute cap', () => {
    expect(
      operationalOnchainFeeSats({
        vbytes: 2_000,
        satPerV: 25,
        feerateCapSatPerV: 25,
        absoluteFeeCapSats: 20_000,
      }),
    ).toBe(20_000)
  })

  it('keeps Savings recovery quotes inside the baked release ceilings', () => {
    const transition = operationalOnchainFeeSats({
      vbytes: SAVINGS_TRANSITION_VBYTES,
      satPerV: FEERATE_CEILING_SAT_PER_V,
    })
    const claim = operationalOnchainFeeSats({
      vbytes: SAVINGS_CLAIM_VBYTES,
      satPerV: FEERATE_CEILING_SAT_PER_V,
    })
    expect(transition).toBeLessThanOrEqual(ABSOLUTE_FEE_CEILING_SATS)
    expect(claim).toBeLessThanOrEqual(ABSOLUTE_FEE_CEILING_SATS)
    expect(transition).toBeGreaterThan(0)
  })
})

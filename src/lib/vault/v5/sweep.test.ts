import { describe, expect, it } from 'vitest'
import { TEMPLATE_VERSION } from '../constants'
import { buildV5Descriptor } from './descriptor'
import { V5_FIXTURE } from './fixtures'
import { assertSweepAllowed, leftoverV4Template, sweepDest } from './sweep'

describe('v4 leftover sweep', () => {
  const dest = buildV5Descriptor(V5_FIXTURE)

  it('only treats the live v4 template as leftover', () => {
    expect(leftoverV4Template(TEMPLATE_VERSION)).toBe(true)
    expect(leftoverV4Template(dest.templateVersion)).toBe(false)
    expect(leftoverV4Template(undefined)).toBe(false)
  })

  it('pays Daily leftover to the v5 Daily address, Savings to Savings', () => {
    expect(sweepDest(dest, 'daily')).toBe(dest.daily.address)
    expect(sweepDest(dest, 'savings')).toBe(dest.savings.address)
    expect(dest.daily.address).not.toBe(dest.savings.address)
  })

  it('refuses a same-address or v5-to-v5 sweep', () => {
    expect(() =>
      assertSweepAllowed({
        fromTemplate: TEMPLATE_VERSION,
        fromAddress: dest.daily.address,
        dest,
        kind: 'daily',
      }),
    ).toThrow(/differ/)
    expect(() =>
      assertSweepAllowed({
        fromTemplate: dest.templateVersion,
        fromAddress: 'tb1pqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq8mqqq',
        dest,
        kind: 'daily',
      }),
    ).toThrow(/leftover v4/)
  })
})

import { describe, expect, it } from 'vitest'
import { arkadeIntentFeePolicyDigest, requireCompleteIntentFeePolicy } from './feePolicy'

const VECTOR = {
  offchainInput: '5.0',
  offchainOutput: 'amount * 0.001',
  onchainInput: '7.0',
  onchainOutput: 'amount * 0.002',
} as const

describe('Arkade intent fee-policy commitment', () => {
  it('matches the cross-language tagged-hash vector', () => {
    expect(arkadeIntentFeePolicyDigest(VECTOR)).toBe('0315f524ae0610202998492284c074829ab156bea680b8313adfa25bdb782fb4')
  })

  it('binds field order and exact CEL bytes', () => {
    expect(arkadeIntentFeePolicyDigest({ ...VECTOR, offchainInput: '5.00' })).not.toBe(
      arkadeIntentFeePolicyDigest(VECTOR),
    )
    expect(arkadeIntentFeePolicyDigest({ ...VECTOR, offchainOutput: ` ${VECTOR.offchainOutput}` })).not.toBe(
      arkadeIntentFeePolicyDigest(VECTOR),
    )
  })

  it('accepts explicit empty programs but rejects missing or non-string fields', () => {
    expect(() => arkadeIntentFeePolicyDigest({ ...VECTOR, offchainInput: '' })).not.toThrow()
    expect(() => requireCompleteIntentFeePolicy({ ...VECTOR, offchainInput: undefined })).toThrow(/offchainInput/)
    expect(() => requireCompleteIntentFeePolicy({ ...VECTOR, onchainOutput: 7 } as never)).toThrow(/onchainOutput/)
  })
})

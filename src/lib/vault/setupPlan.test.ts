import { describe, expect, it } from 'vitest'
import {
  DEMO_HARDWARE_PUB,
  DEMO_RECOVERY_PUB,
  emptySetupPlan,
  isFixturePub,
  parseCompressedPub,
  planReady,
  sameRole,
} from './setup'

describe('vault setup plan', () => {
  it('accepts a compressed hardware key and does not require recovery', () => {
    expect(parseCompressedPub(DEMO_HARDWARE_PUB)).toBe(DEMO_HARDWARE_PUB)
    expect(sameRole(DEMO_HARDWARE_PUB, DEMO_RECOVERY_PUB)).toBe(false)
    const plan = {
      ...emptySetupPlan(),
      acceptedDesign: true,
      hardwarePub: DEMO_HARDWARE_PUB,
    }
    expect(planReady(plan)).toBe(true)
  })

  it('rejects a plan with no hardware key', () => {
    const plan = {
      ...emptySetupPlan(),
      acceptedDesign: true,
    }
    expect(planReady(plan)).toBe(false)
  })

  it('rejects a truncated key', () => {
    expect(() => parseCompressedPub('02c6047f')).toThrow(/33-byte/)
  })

  it('names the BIP340 test-vector pubs as fixtures', () => {
    expect(isFixturePub(DEMO_HARDWARE_PUB)).toBe(true)
    expect(isFixturePub(DEMO_RECOVERY_PUB)).toBe(true)
    expect(isFixturePub('03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })
})

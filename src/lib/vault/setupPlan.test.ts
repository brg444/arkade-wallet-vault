import { describe, expect, it } from 'vitest'
import {
  DEMO_HARDWARE_PUB,
  KNOWN_UNSAFE_FIXTURE_PUBS,
  UNSAFE_GENERATOR_2G,
  UNSAFE_GENERATOR_G,
  emptySetupPlan,
  isFixturePub,
  parseCompressedPub,
  planReady,
  sameRole,
} from './setupPlan'

describe('vault setup plan', () => {
  it('accepts hardware without recovery, and rejects the same key as recovery', () => {
    expect(parseCompressedPub(DEMO_HARDWARE_PUB)).toBe(DEMO_HARDWARE_PUB)
    expect(sameRole(UNSAFE_GENERATOR_2G, UNSAFE_GENERATOR_G)).toBe(false)
    const noRecovery = {
      ...emptySetupPlan(),
      acceptedDesign: true,
      hardwarePub: DEMO_HARDWARE_PUB,
    }
    expect(planReady(noRecovery)).toBe(true)
    const same = {
      ...noRecovery,
      recoveryPub: DEMO_HARDWARE_PUB,
    }
    expect(planReady(same)).toBe(false)
    const plan = {
      ...noRecovery,
      recoveryPub: '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
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

  it('keeps both G and 2G on the known-unsafe denylist', () => {
    expect(KNOWN_UNSAFE_FIXTURE_PUBS).toEqual([UNSAFE_GENERATOR_G, UNSAFE_GENERATOR_2G])
    expect(isFixturePub(UNSAFE_GENERATOR_G)).toBe(true)
    expect(isFixturePub(UNSAFE_GENERATOR_2G)).toBe(true)
    expect(isFixturePub('03' + UNSAFE_GENERATOR_G.slice(2))).toBe(true)
    expect(isFixturePub('03' + UNSAFE_GENERATOR_2G.slice(2))).toBe(true)
    expect(isFixturePub('03aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })
})

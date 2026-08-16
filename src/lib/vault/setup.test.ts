import { describe, expect, it } from 'vitest'
import { DEMO_HARDWARE_PUB, DEMO_RECOVERY_PUB, emptySetupPlan, parseCompressedPub, planReady, sameRole } from './setup'

describe('vault setup plan', () => {
  it('accepts compressed hardware and recovery keys that are independent', () => {
    expect(parseCompressedPub(DEMO_HARDWARE_PUB)).toBe(DEMO_HARDWARE_PUB)
    expect(sameRole(DEMO_HARDWARE_PUB, DEMO_RECOVERY_PUB)).toBe(false)
    const plan = {
      ...emptySetupPlan(),
      acceptedDesign: true,
      hardwarePub: DEMO_HARDWARE_PUB,
      recoveryPub: DEMO_RECOVERY_PUB,
    }
    expect(planReady(plan)).toBe(true)
  })

  it('rejects the same key for hardware and recovery', () => {
    const plan = {
      ...emptySetupPlan(),
      acceptedDesign: true,
      hardwarePub: DEMO_HARDWARE_PUB,
      recoveryPub: DEMO_HARDWARE_PUB,
    }
    expect(sameRole(plan.hardwarePub, plan.recoveryPub)).toBe(true)
    expect(planReady(plan)).toBe(false)
  })

  it('rejects a truncated key', () => {
    expect(() => parseCompressedPub('02c6047f')).toThrow(/33-byte/)
  })
})

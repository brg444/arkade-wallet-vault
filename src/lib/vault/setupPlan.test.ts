import { afterEach, describe, expect, it } from 'vitest'
import {
  FORBIDDEN_PUBLIC_KEY_2G,
  FORBIDDEN_PUBLIC_KEY_G,
  emptySetupPlan,
  loadSetupPlan,
  parseCompressedPub,
  planReady,
  sameRole,
  saveSetupPlan,
  SETUP_STORE_KEY,
} from './setupPlan'
import { PROGRAM_FIXTURE } from './program/fixtures'

afterEach(() => localStorage.clear())

describe('vault setup plan', () => {
  it('accepts hardware without recovery, and rejects the same key as recovery', () => {
    expect(parseCompressedPub(PROGRAM_FIXTURE.hardwarePub)).toBe(PROGRAM_FIXTURE.hardwarePub)
    expect(sameRole(FORBIDDEN_PUBLIC_KEY_2G, FORBIDDEN_PUBLIC_KEY_G)).toBe(false)
    const noRecovery = {
      ...emptySetupPlan(),
      acceptedDesign: true,
      hardwarePub: PROGRAM_FIXTURE.hardwarePub,
    }
    expect(planReady(noRecovery)).toBe(true)
    const same = {
      ...noRecovery,
      recoveryPub: PROGRAM_FIXTURE.hardwarePub,
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

  it('keeps the public generator points distinct from ordinary fixture keys', () => {
    expect(FORBIDDEN_PUBLIC_KEY_G).not.toBe(PROGRAM_FIXTURE.hardwarePub)
    expect(FORBIDDEN_PUBLIC_KEY_2G).not.toBe(PROGRAM_FIXTURE.hardwarePub)
  })

  it('round-trips the complete configurable policy shape', () => {
    const plan = {
      ...emptySetupPlan(),
      hardwarePub: PROGRAM_FIXTURE.hardwarePub,
      acceptedDesign: true,
    }
    saveSetupPlan(plan)
    expect(loadSetupPlan()).toEqual(plan)
  })

  it('does not migrate a setup plan that predates configurable fee policy', () => {
    localStorage.setItem(
      SETUP_STORE_KEY,
      JSON.stringify({
        hardwarePub: PROGRAM_FIXTURE.hardwarePub,
        recoveryPub: '',
        txCapSats: 50_000,
        dailyLimitSats: 100_000,
        acceptedDesign: true,
        complete: true,
      }),
    )
    expect(loadSetupPlan()).toBeNull()
  })
})

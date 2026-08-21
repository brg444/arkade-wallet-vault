import { describe, expect, it } from 'vitest'
import { createAuthorizeRetryState } from './authorizeretry.js'

describe('authorize retry state', () => {
  it('retains the exact staged request only until authorization succeeds', () => {
    const retry = createAuthorizeRetryState()
    const challengeHex = '11'.repeat(32)
    const reviewKey = 'same transaction'
    const body = { psbt: 'exact-psbt', credentialId: 'credential' }
    const validation = { submittedB64: 'exact-psbt' }

    expect(retry.hasPending()).toBe(false)
    retry.stage(reviewKey, body, validation, challengeHex)
    expect(retry.hasPending()).toBe(true)
    expect(JSON.parse(retry.pendingFor(reviewKey).bodyJSON)).toEqual(body)
    expect(retry.pendingFor('different transaction')).toBeNull()

    retry.markAuthorized(reviewKey, {
      challengeHex,
      expectedTxid: '22'.repeat(32),
      replay: true,
    })
    expect(retry.hasPending()).toBe(false)
    expect(retry.pendingFor(reviewKey)).toBeNull()
    expect(retry.completedFor(reviewKey)).toMatchObject({ replay: true })
  })
})

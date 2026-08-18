import { describe, expect, it } from 'vitest'
import { deriveSession, pendingAge, remainingCsv } from './session'

describe('v5 recovery session', () => {
  it('starts CSV on the confirmed pending height, not the Normal UTXO age', () => {
    expect(pendingAge(100, 105)).toBe(6)
    expect(remainingCsv(6, 100, 104)).toBe(1)
    expect(remainingCsv(6, 100, 105)).toBe(0)
    const youngNormal = deriveSession(6, { tipHeight: 200, requested: true })
    expect(youngNormal.state).toBe('requested')
    expect(youngNormal.claimable).toBe(false)
  })

  it('becomes claimable only after the new pending delay', () => {
    const pending = deriveSession(6, {
      tipHeight: 104,
      pending: { txid: 'aa', vout: 0, value: 50_000, confirmed: true, blockHeight: 100 },
    })
    expect(pending.state).toBe('pending')
    expect(pending.remaining).toBe(1)
    expect(pending.claimable).toBe(false)
    const ready = deriveSession(6, {
      tipHeight: 105,
      pending: { txid: 'aa', vout: 0, value: 50_000, confirmed: true, blockHeight: 100 },
    })
    expect(ready.state).toBe('claimable')
    expect(ready.claimable).toBe(true)
  })

  it('marks clawback vs claim, conflict, and reorg from chain facts', () => {
    expect(
      deriveSession(6, {
        tipHeight: 110,
        pending: { txid: 'aa', vout: 0, value: 50_000, confirmed: true, blockHeight: 100 },
        spends: [{ txid: 'bb', confirmed: true, dest: 'quarantine' }],
      }).state,
    ).toBe('cancelled')
    expect(
      deriveSession(6, {
        tipHeight: 110,
        pending: { txid: 'aa', vout: 0, value: 50_000, confirmed: true, blockHeight: 100 },
        spends: [{ txid: 'cc', confirmed: true, dest: 'other' }],
      }).state,
    ).toBe('claimed')
    expect(
      deriveSession(6, {
        tipHeight: 110,
        spends: [
          { txid: 'bb', confirmed: false, dest: 'quarantine' },
          { txid: 'cc', confirmed: false, dest: 'other' },
        ],
      }).state,
    ).toBe('conflicted')
    expect(
      deriveSession(6, {
        tipHeight: 99,
        previouslyConfirmedHeight: 100,
      }).state,
    ).toBe('reorged')
    expect(
      deriveSession(6, { tipHeight: 10, pending: { txid: 'aa', vout: 0, value: 1, confirmed: false } }).state,
    ).toBe('broadcast')
  })
})

import { describe, expect, it } from 'vitest'
import { buildV5Descriptor } from './descriptor'
import { V5_FIXTURE } from './fixtures'
import { alertCopy, outpointId, pollPendingInitiates } from './watch'

describe('v5 pending watcher', () => {
  it('alerts the first time a pending coin appears and does not repeat', async () => {
    const descriptor = buildV5Descriptor(V5_FIXTURE)
    const coin = { txid: 'aa'.repeat(32), vout: 0, value: 20_000, status: { confirmed: true, block_height: 10 } }
    const first = await pollPendingInitiates({
      descriptor,
      seen: new Set(),
      fetchUtxos: async (address) => (address === descriptor.pending['savings-hardware'].address ? [coin] : []),
    })
    expect(first.alerts).toHaveLength(1)
    expect(first.alerts[0].familyKey).toBe('savings-hardware')
    expect(alertCopy(first.alerts[0])).toMatch(/started recovery on Savings with hardware/i)
    const second = await pollPendingInitiates({
      descriptor,
      seen: first.seen,
      fetchUtxos: async (address) => (address === descriptor.pending['savings-hardware'].address ? [coin] : []),
    })
    expect(second.alerts).toHaveLength(0)
    expect(outpointId(coin.txid, coin.vout)).toBe(`${coin.txid}:0`)
  })
})

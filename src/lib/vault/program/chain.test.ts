import { describe, expect, it } from 'vitest'
import { classifySpendDest, loadSessionView, pickSpendOutput } from './chain'
import { deriveSession } from './session'

function json(url: string, body: unknown, ok = true) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: ok ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('staged chain session view', () => {
  it('classifies dest 0 as quarantine and skips P2A/packet', () => {
    expect(classifySpendDest('5120aa', '5120aa')).toBe('quarantine')
    expect(classifySpendDest('5120bb', '5120aa')).toBe('other')
    expect(
      pickSpendOutput([{ scriptpubkey: '51024e73' }, { scriptpubkey: '6a5101' }, { scriptpubkey: '5120aa' }]),
    ).toBe('5120aa')
  })

  it('loads a confirmed pending coin from Esplora', async () => {
    const view = await loadSessionView({
      base: 'https://mutinynet.com/api',
      pendingAddress: 'tb1ppending',
      quarantineScriptHex: '5120aa',
      fetch: async (url) => {
        if (url.endsWith('/blocks/tip/height')) return json(url, '105')
        if (url.includes('/address/tb1ppending/utxo')) {
          return json(url, [{ txid: 'aa', vout: 0, value: 50_000, status: { confirmed: true, block_height: 100 } }])
        }
        throw new Error(url)
      },
    })
    const snap = deriveSession(6, view)
    expect(snap.state).toBe('claimable')
    expect(snap.confirmedHeight).toBe(100)
  })

  it('loads a clawback spend when the pending outpoint is gone', async () => {
    const view = await loadSessionView({
      base: 'https://mutinynet.com/api',
      pendingAddress: 'tb1ppending',
      quarantineScriptHex: '5120dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      outpoint: { txid: 'aa', vout: 0 },
      fetch: async (url) => {
        if (url.endsWith('/blocks/tip/height')) return json(url, '110')
        if (url.includes('/utxo')) return json(url, [])
        if (url.includes('/outspend/0')) return json(url, { spent: true, txid: 'bb', status: { confirmed: true } })
        if (url.endsWith('/tx/bb')) {
          return json(url, {
            vout: [
              { scriptpubkey: '5120dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' },
              { scriptpubkey: '51024e73' },
            ],
          })
        }
        throw new Error(url)
      },
    })
    expect(deriveSession(6, view).state).toBe('cancelled')
  })
})

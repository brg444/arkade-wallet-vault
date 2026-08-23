import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmedSpendables, ESPLORA_TX_PAGE_SIZE, fetchAddressTxs, type EsploraTx, type EsploraUtxo } from './esplora'

function utxo(value: number, confirmed = true, txid = 'aa'): EsploraUtxo {
  return { txid, vout: 0, value, status: { confirmed } }
}

describe('confirmedSpendables', () => {
  it('picks the smallest confirmed coin that covers the payment', () => {
    const chosen = confirmedSpendables([utxo(80_000), utxo(20_000), utxo(21_500, false)], 21_000)
    expect(chosen.map((coin) => coin.value)).toEqual([80_000])
  })

  it('combines fragmented confirmed savings in canonical outpoint order', () => {
    const chosen = confirmedSpendables(
      [utxo(30_000, true, 'bb'), utxo(25_000, true, 'aa'), utxo(20_000, false, 'cc')],
      50_000,
    )
    expect(chosen.map((coin) => `${coin.txid}:${coin.vout}`)).toEqual(['aa:0', 'bb:0'])
  })

  it('ignores unconfirmed coins', () => {
    expect(confirmedSpendables([utxo(100_000, false)], 1_000)).toEqual([])
  })
})

function transaction(txid: string, confirmed = true): EsploraTx {
  return { txid, vin: [], vout: [], status: { confirmed } }
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchAddressTxs', () => {
  it('loads every confirmed page while retaining first-page mempool activity', async () => {
    const first = [transaction('mempool', false)]
    for (let index = 0; index < ESPLORA_TX_PAGE_SIZE; index += 1) first.push(transaction(`confirmed-${index}`))
    const second = [transaction('older')]
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(second), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await fetchAddressTxs('tb1p address')

    expect(rows).toHaveLength(ESPLORA_TX_PAGE_SIZE + 2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/esplora/address/tb1p%20address/txs')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/esplora/address/tb1p%20address/txs/chain/confirmed-${ESPLORA_TX_PAGE_SIZE - 1}`,
    )
  })

  it('deduplicates a transaction repeated across moving pages', async () => {
    const first = Array.from({ length: ESPLORA_TX_PAGE_SIZE }, (_, index) => transaction(`tx-${index}`))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(first), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([first.at(-1), transaction('older')]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await fetchAddressTxs('tb1psavings')

    expect(rows.filter((row) => row.txid === first.at(-1)?.txid)).toHaveLength(1)
    expect(rows).toHaveLength(ESPLORA_TX_PAGE_SIZE + 1)
  })
})

import { describe, expect, it } from 'vitest'
import { confirmedSpendables, type EsploraUtxo } from './esplora'

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

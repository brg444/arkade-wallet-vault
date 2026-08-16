import { describe, expect, it } from 'vitest'
import { confirmedSpendable, type EsploraUtxo } from './esplora'

function utxo(value: number, confirmed = true, txid = 'aa'): EsploraUtxo {
  return { txid, vout: 0, value, status: { confirmed } }
}

describe('confirmedSpendable', () => {
  it('picks the smallest confirmed coin that covers the payment', () => {
    const chosen = confirmedSpendable([utxo(80_000), utxo(20_000), utxo(21_500, false)], 21_000)
    expect(chosen?.value).toBe(80_000)
  })

  it('ignores unconfirmed coins', () => {
    expect(confirmedSpendable([utxo(100_000, false)], 1_000)).toBeNull()
  })
})

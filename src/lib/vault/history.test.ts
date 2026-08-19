import { describe, expect, it } from 'vitest'
import { classifyAddressTx, historyFromTxs, type VaultHistoryItem } from './history'
import type { EsploraTx } from './esplora'

const ADDRESS = 'tb1pspend'

function tx(partial: Partial<EsploraTx> & { txid: string }): EsploraTx {
  return {
    vin: [],
    vout: [],
    status: { confirmed: true, block_time: 1 },
    ...partial,
  }
}

describe('vault history', () => {
  it('treats an incoming output as received', () => {
    const item = classifyAddressTx(
      tx({
        txid: 'in',
        vout: [{ scriptpubkey_address: ADDRESS, value: 20_000 }],
      }),
      ADDRESS,
    )
    expect(item).toMatchObject({ type: 'received', amount: 20_000, txid: 'in' })
  })

  it('nets change on a send', () => {
    const item = classifyAddressTx(
      tx({
        txid: 'out',
        vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 50_000 } }],
        vout: [
          { scriptpubkey_address: 'tb1pdest', value: 19_500 },
          { scriptpubkey_address: ADDRESS, value: 30_000 },
        ],
      }),
      ADDRESS,
    )
    expect(item).toMatchObject({ type: 'sent', amount: 20_000 })
  })

  it('ignores unrelated transactions', () => {
    expect(
      classifyAddressTx(
        tx({
          txid: 'other',
          vout: [{ scriptpubkey_address: 'tb1pother', value: 1 }],
        }),
        ADDRESS,
      ),
    ).toBeNull()
  })

  it('puts unconfirmed first, then newest', () => {
    const rows: VaultHistoryItem[] = historyFromTxs(
      [
        tx({
          txid: 'old',
          vout: [{ scriptpubkey_address: ADDRESS, value: 1 }],
          status: { confirmed: true, block_time: 10 },
        }),
        tx({
          txid: 'new',
          vout: [{ scriptpubkey_address: ADDRESS, value: 2 }],
          status: { confirmed: true, block_time: 20 },
        }),
        tx({ txid: 'mem', vout: [{ scriptpubkey_address: ADDRESS, value: 3 }], status: { confirmed: false } }),
      ],
      ADDRESS,
      'spend',
    )
    expect(rows.map((row) => row.txid)).toEqual(['mem', 'new', 'old'])
  })
})

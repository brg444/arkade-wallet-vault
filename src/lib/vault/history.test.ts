import { describe, expect, it } from 'vitest'
import {
  classifyAddressTx,
  groupVaultHistory,
  historyFromTxs,
  historyFromVtxos,
  type VaultHistoryItem,
} from './history'
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

  it('deduplicates a transaction while preferring its confirmed state', () => {
    const rows = historyFromTxs(
      [
        tx({ txid: 'same', vout: [{ scriptpubkey_address: ADDRESS, value: 4_000 }], status: { confirmed: false } }),
        tx({
          txid: 'same',
          vout: [{ scriptpubkey_address: ADDRESS, value: 4_000 }],
          status: { confirmed: true, block_time: 30 },
        }),
      ],
      ADDRESS,
      'savings',
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ txid: 'same', confirmed: true, blockTime: 30 })
  })

  it('classifies indexer VTXOs as spending receives and net sends', () => {
    const rows = historyFromVtxos([
      { txid: 'recv', vout: 0, value: 20_000, createdAtMs: 2_000, isSpent: true, arkTxId: 'send', isLeaf: true },
      { txid: 'send', vout: 1, value: 8_000, createdAtMs: 4_000, isSpent: false, isLeaf: false },
    ])
    expect(rows.map((row) => ({ txid: row.txid, type: row.type, amount: row.amount }))).toEqual([
      { txid: 'send', type: 'sent', amount: 12_000 },
      { txid: 'recv', type: 'received', amount: 20_000 },
    ])
    expect(rows.find((row) => row.txid === 'send')?.confirmed).toBe(true)
  })

  it('keeps a spent offchain receive settled and ignores duplicate outpoints', () => {
    const duplicate = {
      txid: 'receive',
      vout: 0,
      value: 20_000,
      createdAtMs: 2_000,
      isSpent: true,
      arkTxId: 'send',
      isLeaf: false,
    }
    const rows = historyFromVtxos([
      duplicate,
      duplicate,
      { txid: 'send', vout: 1, value: 8_000, createdAtMs: 4_000, isSpent: false, isLeaf: false },
    ])

    expect(rows.filter((row) => row.txid === 'receive')).toEqual([
      expect.objectContaining({ amount: 20_000, confirmed: true, type: 'received' }),
    ])
    expect(rows.find((row) => row.txid === 'send')).toMatchObject({ amount: 12_000, type: 'sent' })
  })

  it('combines multiple wallet outputs from one receive into one activity row', () => {
    const rows = historyFromVtxos([
      { txid: 'receive', vout: 0, value: 12_000, createdAtMs: 2_000, isSpent: false, isLeaf: true },
      { txid: 'receive', vout: 1, value: 8_000, createdAtMs: 2_000, isSpent: false, isLeaf: true },
    ])

    expect(rows).toEqual([
      expect.objectContaining({ txid: 'receive', amount: 20_000, confirmed: true, type: 'received' }),
    ])
  })

  it('groups pending activity before local calendar dates', () => {
    const now = new Date(2026, 7, 23, 12, 0)
    const at = (day: number, hour = 12) => Math.floor(new Date(2026, 7, day, hour, 0).getTime() / 1000)
    const item = (txid: string, confirmed: boolean, blockTime?: number): VaultHistoryItem => ({
      txid,
      type: 'received',
      amount: 1,
      confirmed,
      blockTime,
      account: 'spend',
    })

    const groups = groupVaultHistory(
      [
        item('pending', false),
        item('today', true, at(23)),
        item('yesterday', true, at(22)),
        item('older-a', true, at(8, 15)),
        item('older-b', true, at(8, 9)),
      ],
      Math.floor(now.getTime() / 1000),
    )

    expect(groups.map((group) => group.label)).toEqual(['Preconfirmed', 'Today', 'Yesterday', 'August 8'])
    expect(groups.at(-1)?.items.map((row) => row.txid)).toEqual(['older-a', 'older-b'])
  })

  it('sorts unsorted rows deterministically before grouping them', () => {
    const rows: VaultHistoryItem[] = [
      { txid: 'z', type: 'received', amount: 1, confirmed: true, blockTime: 10, account: 'savings' },
      { txid: 'b', type: 'received', amount: 1, confirmed: false, account: 'savings' },
      { txid: 'a', type: 'received', amount: 1, confirmed: false, account: 'savings' },
    ]

    expect(groupVaultHistory(rows, 20)[0].items.map((row) => row.txid)).toEqual(['a', 'b'])
  })
})

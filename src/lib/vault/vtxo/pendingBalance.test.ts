import type { VirtualCoin } from '@arkade-os/sdk'
import { describe, expect, it } from 'vitest'
import { vtxoBalanceWithPending } from './pendingBalance'
import type { PersistedVtxoSpend } from './spend'

const pending = {
  operationId: 'payment',
  stage: 'authorized',
  arkTxid: 'funding',
  amountSats: 1505,
  feeSats: 0,
  changeSats: 31953,
  changeVout: 1,
  reservedInputs: [{ txid: 'input', vout: 0, valueSats: 33458, scriptHex: 'script' }],
} as PersistedVtxoSpend
const input: VirtualCoin = {
  createdAt: new Date(0),
  script: 'script',
  isUnrolled: false,
  virtualStatus: { state: 'preconfirmed' },
  status: { confirmed: false },
  txid: 'input',
  vout: 0,
  value: 33458,
  isSpent: false,
  isSwept: false,
}

describe('pending Spending balance', () => {
  it('keeps a reserved input visible but unavailable', () => {
    expect(vtxoBalanceWithPending([input], [pending])).toEqual({ availableSats: 0, pendingSats: 33458 })
  })
  it('shows protected change when the Operator spends the input before publishing change', () => {
    expect(vtxoBalanceWithPending([{ ...input, isSpent: true }], [pending])).toEqual({
      availableSats: 0,
      pendingSats: 31953,
    })
  })
  it('does not count a stale unspent input after acknowledged Operator submission', () => {
    expect(vtxoBalanceWithPending([input], [{ ...pending, stage: 'operator-submitted' }])).toEqual({
      availableSats: 0,
      pendingSats: 31953,
    })
  })
  it('replaces pending change with the indexed change without doubling it', () => {
    const change = { ...input, txid: 'funding', vout: 1, value: 31953 }
    expect(vtxoBalanceWithPending([{ ...input, isSpent: true }, change], [pending])).toEqual({
      availableSats: 31953,
      pendingSats: 0,
    })
  })
  it('does not double count when change arrives before the old input is marked spent', () => {
    const change = { ...input, txid: 'funding', vout: 1, value: 31953 }
    expect(vtxoBalanceWithPending([input, change], [pending])).toEqual({ availableSats: 31953, pendingSats: 0 })
  })
  it('does not count projected change twice when a later operation spends it', () => {
    const next = {
      ...pending,
      operationId: 'next',
      arkTxid: 'next-funding',
      stage: 'operator-submitted' as const,
      amountSats: 5000,
      changeSats: 26953,
      reservedInputs: [{ txid: 'funding', vout: 1, valueSats: 31953, scriptHex: 'script' }],
    }
    expect(vtxoBalanceWithPending([], [{ ...pending, stage: 'operator-submitted' }, next])).toEqual({
      availableSats: 0,
      pendingSats: 26953,
    })
  })

  it('does not resurrect change already spent by another transaction', () => {
    const change = { ...input, txid: 'funding', vout: 1, value: 31953, isSpent: true }
    expect(vtxoBalanceWithPending([{ ...input, isSpent: true }, change], [pending])).toEqual({
      availableSats: 0,
      pendingSats: 0,
    })
  })
  it('deduplicates overlapping operations and repeated indexer outputs', () => {
    expect(vtxoBalanceWithPending([input, input], [pending, pending])).toEqual({ availableSats: 0, pendingSats: 33458 })
    expect(vtxoBalanceWithPending([input, input], [])).toEqual({ availableSats: 33458, pendingSats: 0 })
  })
  it('keeps independent inputs available and excludes settled inputs', () => {
    expect(
      vtxoBalanceWithPending(
        [input, { ...input, txid: 'other', value: 1000 }, { ...input, txid: 'settled', settledBy: 'batch' }],
        [pending],
      ),
    ).toEqual({ availableSats: 1000, pendingSats: 33458 })
  })
})

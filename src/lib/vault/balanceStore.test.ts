import { afterEach, describe, expect, it } from 'vitest'
import { loadBalanceSnapshot, saveBalanceSnapshot } from './balanceStore'

afterEach(() => localStorage.clear())

describe('balanceStore', () => {
  it('round-trips a snapshot and ignores corrupt rows', () => {
    saveBalanceSnapshot('vault-a', {
      boardingBalance: 1_000,
      history: [],
      savingsSats: 2_000,
      savingsSpendableSats: 2_000,
      vtxoSpendingSats: 3_000,
    })
    expect(loadBalanceSnapshot('vault-a')?.vtxoSpendingSats).toBe(3_000)
    expect(loadBalanceSnapshot('')).toBeNull()
    localStorage.setItem('arkade-vault-v2:balance-snapshot:vault-a', '{')
    expect(loadBalanceSnapshot('vault-a')).toBeNull()
  })
})

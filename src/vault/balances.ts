export type VaultBalancePosition = {
  availableSats: number
  pendingSats: number
  totalSats: number
}

export type VaultAccountPositions = {
  spending: VaultBalancePosition
  savings: VaultBalancePosition
}

export const EMPTY_VAULT_POSITIONS: VaultAccountPositions = {
  spending: { availableSats: 0, pendingSats: 0, totalSats: 0 },
  savings: { availableSats: 0, pendingSats: 0, totalSats: 0 },
}

export function vaultAccountPositions(input: {
  boardingSats: number
  savingsAvailableSats: number
  savingsTotalSats: number
  spendingAvailableSats: number
  spendingPendingSats?: number
}): VaultAccountPositions {
  const spendingAvailableSats = Math.max(0, input.spendingAvailableSats)
  const spendingPendingSats = Math.max(0, input.boardingSats) + Math.max(0, input.spendingPendingSats || 0)
  const savingsAvailableSats = Math.max(0, input.savingsAvailableSats)
  const savingsTotalSats = Math.max(savingsAvailableSats, input.savingsTotalSats)

  return {
    spending: {
      availableSats: spendingAvailableSats,
      pendingSats: spendingPendingSats,
      totalSats: spendingAvailableSats + spendingPendingSats,
    },
    savings: {
      availableSats: savingsAvailableSats,
      pendingSats: savingsTotalSats - savingsAvailableSats,
      totalSats: savingsTotalSats,
    },
  }
}

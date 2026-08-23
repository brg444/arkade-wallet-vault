import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultHistory from './History'

function renderHistory(overrides: Partial<VaultContextProps>) {
  const value = {
    account: 'spend',
    history: [],
    openTx: vi.fn(),
    ...overrides,
  } as unknown as VaultContextProps
  render(
    <ToastProvider>
      <VaultContext.Provider value={value}>
        <VaultHistory />
      </VaultContext.Provider>
    </ToastProvider>,
  )
  return value
}

describe('Vault history', () => {
  it('names the selected account in an actionable empty state', () => {
    renderHistory({ account: 'savings' })
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy()
    expect(screen.getByText('Savings')).toBeTruthy()
    expect(screen.getByText(/Add bitcoin to your Savings address/i)).toBeTruthy()
  })

  it('shows pending state, amount units, and opens a transaction', async () => {
    const user = userEvent.setup()
    const tx = {
      txid: 'pending-tx',
      type: 'received' as const,
      amount: 12_000,
      confirmed: false,
      account: 'spend' as const,
    }
    const value = renderHistory({ history: [tx] })

    expect(screen.getByRole('heading', { name: 'Pending' })).toBeTruthy()
    expect(screen.getByText('Pending confirmation')).toBeTruthy()
    expect(screen.getByText('+12,000 SATS')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Received 12,000 SATS.*Pending confirmation/i }))
    expect(value.openTx).toHaveBeenCalledWith(tx)
  })
})

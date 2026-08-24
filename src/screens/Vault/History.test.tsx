import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultHistory from './History'

function renderHistory(overrides: Partial<VaultContextProps>) {
  const value = {
    account: 'spend',
    balancesLoaded: true,
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

  it('shows preconfirmation state, amount units, and opens a transaction', async () => {
    const user = userEvent.setup()
    const tx = {
      txid: 'pending-tx',
      type: 'received' as const,
      amount: 12_000,
      confirmed: false,
      account: 'spend' as const,
    }
    const value = renderHistory({ history: [tx] })

    expect(screen.getByRole('heading', { name: 'Preconfirmed' })).toBeTruthy()
    expect(screen.getAllByText('Preconfirmed')).toHaveLength(2)
    expect(screen.getByText('+12,000 SATS')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Received 12,000 SATS.*Preconfirmed/i }))
    expect(value.openTx).toHaveBeenCalledWith(tx)
  })

  it('does not show a false empty state while the first snapshot is loading', () => {
    renderHistory({ account: 'spend', balancesLoaded: false })
    expect(screen.getByText('Loading activity…')).toBeTruthy()
    expect(screen.queryByText(/No Spending activity/i)).toBeNull()
  })

  it('uses onchain confirmation language for Savings activity', () => {
    renderHistory({
      account: 'savings',
      history: [
        {
          txid: 'mempool-tx',
          type: 'sent',
          amount: 5_000,
          confirmed: false,
          account: 'savings',
        },
      ],
    })

    expect(screen.getByRole('heading', { name: 'Pending' })).toBeTruthy()
    expect(screen.getByText('Pending confirmation')).toBeTruthy()
  })

  it('reopens a phone-signed Savings transfer waiting for hardware', async () => {
    const user = userEvent.setup()
    const pending = {
      txid: 'pending-savings:1',
      type: 'sent' as const,
      amount: 51_500,
      confirmed: false,
      account: 'savings' as const,
      activity: 'savings-handoff' as const,
    }
    const value = renderHistory({ account: 'savings', history: [pending] })

    expect(screen.getByRole('heading', { name: 'Pending' })).toBeTruthy()
    expect(screen.getByText('Waiting for hardware')).toBeTruthy()
    expect(screen.getByText('Complete or cancel')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Waiting for hardware 51,500 SATS/i }))
    expect(value.openTx).toHaveBeenCalledWith(pending)
  })

  it('keeps a local hardware handoff visible while remote Savings activity loads', () => {
    renderHistory({
      account: 'savings',
      balancesLoaded: false,
      history: [
        {
          txid: 'pending-savings:2',
          type: 'sent',
          amount: 21_500,
          confirmed: false,
          account: 'savings',
          activity: 'savings-handoff',
        },
      ],
    })

    expect(screen.getByText('Waiting for hardware')).toBeTruthy()
    expect(screen.getByText('Complete or cancel')).toBeTruthy()
    expect(screen.queryByText('Loading activity…')).toBeNull()
  })
})

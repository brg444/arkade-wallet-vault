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
    expect(screen.getByRole('heading', { name: 'Recent' })).toBeTruthy()
    expect(screen.getByText(/Add bitcoin to your Savings address/i)).toBeTruthy()
  })

  it('shows a preconfirmed Arkade receive as confirmed', () => {
    renderHistory({
      history: [
        {
          txid: 'arkade-receive',
          type: 'received',
          amount: 21_000,
          confirmed: true,
          blockTime: 1_700_000_000,
          account: 'spend',
        },
      ],
    })

    expect(screen.getByText(/^Confirmed/)).toBeTruthy()
    expect(screen.queryByText('Pending')).toBeNull()
    expect(screen.getByRole('button', { name: /Received 21,000 ₿SATS.*Confirmed/i })).toHaveTextContent('+21,000')
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
    expect(screen.getAllByText('Pending')).toHaveLength(2)
    const transaction = screen.getByRole('button', { name: /Received 12,000 ₿SATS.*Pending/i })
    expect(transaction).toHaveTextContent('+12,000')
    await user.click(transaction)
    expect(value.openTx).toHaveBeenCalledWith(tx)
  })

  it('shows detected boarding funds as a pending receive', () => {
    renderHistory({
      history: [
        {
          txid: 'boarding-tx',
          type: 'received',
          amount: 50_000,
          confirmed: false,
          account: 'spend',
          activity: 'boarding',
        },
      ],
    })

    expect(screen.getByRole('heading', { name: 'Pending' })).toBeTruthy()
    expect(screen.getByText('Received')).toBeTruthy()
    expect(screen.getAllByText('Pending')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Received 50,000 ₿SATS.*Pending/i })).toHaveTextContent('+50,000')
  })

  it('shows settled boarding activity as confirmed', () => {
    renderHistory({
      history: [
        {
          txid: 'settled-boarding-tx',
          type: 'received',
          amount: 50_000,
          confirmed: true,
          blockTime: 10,
          account: 'spend',
          activity: 'boarding',
        },
      ],
    })

    expect(screen.getByText(/^Confirmed/)).toBeTruthy()
    expect(screen.queryByText('Pending')).toBeNull()
  })

  it('does not show a false empty state while the first snapshot is loading', () => {
    renderHistory({ account: 'spend', balancesLoaded: false })
    expect(screen.getByText('Loading activity…')).toBeTruthy()
    expect(screen.queryByText(/No Spending activity/i)).toBeNull()
  })

  it('does not remain busy after a terminal activity error', () => {
    renderHistory({ balancesLoaded: false, balanceError: 'Could not load activity' })
    expect(screen.getByTestId('vault-history').getAttribute('aria-busy')).toBe('false')
    expect(screen.getByText('Activity is unavailable. Refresh to try again.')).toBeTruthy()
  })

  it('uses the same pending language for Savings activity', () => {
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
    expect(screen.getAllByText('Pending')).toHaveLength(2)
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
    await user.click(screen.getByRole('button', { name: /Waiting for hardware 51,500 ₿SATS/i }))
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

  it('describes a terminal failed Lightning payment as needing recovery', () => {
    renderHistory({
      history: [
        {
          txid: 'lightning-failed',
          type: 'sent',
          amount: 2_125,
          confirmed: true,
          account: 'spend',
          activity: 'lightning',
          lightningState: 'failed',
          lightningRfqId: 'rfq-failed',
        },
      ],
    })

    expect(screen.getByText('Needs recovery')).toBeTruthy()
  })
})

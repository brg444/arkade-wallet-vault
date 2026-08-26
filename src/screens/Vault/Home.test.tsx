import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultHome from './Home'

vi.mock('../../lib/vault/update', () => ({ reloadIfNewerWallet: () => Promise.resolve(false) }))

function renderHome(overrides: Partial<VaultContextProps>) {
  const value = {
    account: 'spend',
    amountSats: 12_000,
    balancesLoaded: true,
    boardingAddress: 'tb1pboardingdestination',
    busy: false,
    canSend: true,
    dailyLimit: 100_000,
    dailyRemaining: 100_000,
    error: '',
    history: [],
    initiateAlert: '',
    liveNetwork: false,
    navigate: vi.fn(),
    openRecover: vi.fn(),
    openSendScan: vi.fn(),
    refreshBalance: vi.fn().mockResolvedValue(undefined),
    savingsAddress: 'tb1psavingsaddress',
    savingsSats: 50_000,
    setAccount: vi.fn(),
    setSpendDraft: vi.fn(),
    spendingArkAddress: 'tark1spendingaddress',
    ...overrides,
  } as unknown as VaultContextProps
  render(
    <ToastProvider>
      <VaultContext.Provider value={value}>
        <VaultHome />
      </VaultContext.Provider>
    </ToastProvider>,
  )
  return value
}

describe('Vault home account boundaries', () => {
  it('uses the Arkade address for Spending', () => {
    renderHome({ account: 'spend' })
    expect(screen.getByTestId('account-address').textContent).toContain('tark1s')
    expect(document.querySelector('.vault-refresh')).toBeTruthy()
  })

  it('starts Savings to Spending at the pinned boarding address', async () => {
    const user = userEvent.setup()
    const value = renderHome({ account: 'savings' })
    await user.click(screen.getByRole('button', { name: 'Move to Spending' }))
    expect(value.setSpendDraft).toHaveBeenCalledWith({ address: value.boardingAddress })
    expect(value.navigate).toHaveBeenCalledWith('send')
  })

  it('makes Savings actions and hardware approval explicit', () => {
    renderHome({ account: 'savings' })
    expect(screen.getByRole('button', { name: 'Move to Spending' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Add to Savings' })).toHaveLength(2)
    expect(screen.getByText(/Moving funds.*hardware key/i)).toBeTruthy()
  })

  it('does not expose background boarding state on Home', () => {
    renderHome({ account: 'spend' })
    expect(screen.queryByText(/boarding|processing|Moving received Bitcoin|Face ID/i)).toBeNull()
  })

  it('does not present zero as the balance before the first snapshot loads', () => {
    renderHome({ balancesLoaded: false, amountSats: 0 })
    expect(screen.getByTestId('vault-balance')).toHaveTextContent('—')
    expect(screen.getByText('Loading Spending balance…')).toBeTruthy()
  })

  it('replaces terminal loading with a clear balance retry action', async () => {
    const user = userEvent.setup()
    const value = renderHome({ balanceError: 'Wallet activity is unavailable.', balancesLoaded: false })

    expect(screen.queryByText('Loading Spending balance…')).toBeNull()
    expect(screen.getByTestId('vault-balance')).not.toHaveAttribute('aria-busy')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(value.refreshBalance).toHaveBeenCalledTimes(1)
  })
})

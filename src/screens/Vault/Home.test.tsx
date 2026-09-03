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
    positions: {
      spending: { availableSats: 12_000, pendingSats: 0, totalSats: 12_000 },
      savings: { availableSats: 50_000, pendingSats: 0, totalSats: 50_000 },
    },
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
  it('keeps receive details behind the explicit Home utilities', () => {
    renderHome({ account: 'spend' })
    expect(screen.queryByTestId('account-address')).toBeNull()
    expect(screen.getByRole('button', { name: 'Scan a Spending payment' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Receive to Spending' })).toBeTruthy()
    expect(document.querySelector('.vault-refresh')).toBeTruthy()
  })

  it('starts Savings to Spending at the pinned boarding address', async () => {
    const user = userEvent.setup()
    const value = renderHome({ account: 'savings' })
    await user.click(screen.getByRole('button', { name: 'Move to Spending' }))
    expect(value.setSpendDraft).toHaveBeenCalledWith({ address: value.boardingAddress })
    expect(value.navigate).toHaveBeenCalledWith('send')
  })

  it('keeps the Savings actions explicit without adding send instructions to Home', () => {
    renderHome({ account: 'savings' })
    expect(screen.getByRole('button', { name: 'Move to Spending' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Add to Savings' })).toHaveLength(2)
    expect(screen.queryByText(/hardware key/i)).toBeNull()
  })

  it('surfaces recovery attention as a compact alert instead of an emergency block', () => {
    renderHome({ initiateAlert: 'Someone started recovery' })
    expect(screen.getByTestId('initiate-alert')).toHaveTextContent('Recovery started with hardware')
    expect(screen.getByTestId('initiate-alert')).toHaveTextContent(
      'Open Recovery to review the available cancellation paths.',
    )
    expect(screen.getByRole('button', { name: 'Open Recovery' })).toBeTruthy()
  })

  it('keeps pending boarding separate from the sendable Spending balance', () => {
    renderHome({
      account: 'spend',
      positions: {
        spending: { availableSats: 80_000, pendingSats: 48_000, totalSats: 128_000 },
        savings: { availableSats: 0, pendingSats: 0, totalSats: 0 },
      },
    })
    expect(screen.queryByText('Available to spend')).toBeNull()
    expect(screen.getByTestId('vault-balance')).toHaveTextContent('80,000')
    expect(screen.getByTestId('spending-pending')).toHaveTextContent('48,000 sats arriving')
    expect(screen.getByTestId('spending-total')).toHaveTextContent('128,000 sats total')
  })

  it('does not present zero as the balance before the first snapshot loads', () => {
    renderHome({
      balancesLoaded: false,
      positions: {
        spending: { availableSats: 0, pendingSats: 0, totalSats: 0 },
        savings: { availableSats: 0, pendingSats: 0, totalSats: 0 },
      },
    })
    expect(screen.getByTestId('vault-balance')).toHaveTextContent('—')
    expect(screen.getByTestId('vault-balance')).toHaveAccessibleName('Spending balance loading')
  })

  it('replaces terminal loading with a clear balance retry action', async () => {
    const user = userEvent.setup()
    const value = renderHome({ balanceError: 'Wallet activity is unavailable.', balancesLoaded: false })

    expect(screen.getByTestId('vault-balance')).not.toHaveAttribute('aria-busy')
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(value.refreshBalance).toHaveBeenCalledTimes(1)
  })

  it('uses menu radio semantics and restores focus after Escape', async () => {
    const user = userEvent.setup()
    renderHome({ account: 'spend' })
    const trigger = screen.getByTestId('account-switcher')

    trigger.focus()
    await user.keyboard('{ArrowDown}')
    const spending = screen.getByRole('menuitemradio', { name: /Spending/ })
    expect(spending).toHaveAttribute('aria-checked', 'true')
    expect(spending).toHaveFocus()

    await user.keyboard('{End}')
    expect(screen.getByRole('menuitemradio', { name: /Savings/ })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('dismisses the account menu outside and selects Savings by keyboard', async () => {
    const user = userEvent.setup()
    const value = renderHome({ account: 'spend' })
    const trigger = screen.getByTestId('account-switcher')

    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await user.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()

    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{End}{Enter}')
    expect(value.setAccount).toHaveBeenCalledWith('savings')
    expect(trigger).toHaveFocus()
  })
})

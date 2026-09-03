import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { Fiats } from '../../lib/types'
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
    clearSpendDraft: vi.fn(),
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
  afterEach(() => {
    localStorage.removeItem('arkade-vault-balance-unit')
  })

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
    await user.click(screen.getByRole('button', { name: 'Spending' }))
    expect(value.clearSpendDraft).toHaveBeenCalled()
    expect(value.setSpendDraft).toHaveBeenCalledWith({ address: value.boardingAddress })
    expect(value.navigate).toHaveBeenCalledWith('send')
  })

  it('starts Spending send from a blank draft', async () => {
    const user = userEvent.setup()
    const value = renderHome({ account: 'spend' })
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(value.clearSpendDraft).toHaveBeenCalled()
    expect(value.setSpendDraft).not.toHaveBeenCalled()
    expect(value.navigate).toHaveBeenCalledWith('send')
  })

  it('keeps the Savings actions explicit without adding send instructions to Home', () => {
    renderHome({ account: 'savings' })
    expect(screen.getByRole('button', { name: 'Spending' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Deposit' })).toHaveLength(2)
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

  it('toggles the hero between ₿sats and USD using the fetched price', async () => {
    const user = userEvent.setup()
    const rate = { currency: Fiats.USD, pricePerBtc: 125_000 }
    const setFiatDisplay = vi.fn(async (enabled: boolean) => (enabled ? rate : null))
    renderHome({
      account: 'spend',
      fiatDisplayRate: null,
      setFiatDisplay,
      positions: {
        spending: { availableSats: 80_000, pendingSats: 48_000, totalSats: 128_000 },
        savings: { availableSats: 0, pendingSats: 0, totalSats: 0 },
      },
    })
    const hero = screen.getByTestId('vault-balance')
    expect(hero).toHaveTextContent('₿128,000')
    expect(hero).not.toHaveTextContent('SATS')
    await user.click(hero)
    expect(hero).toHaveTextContent('$160.00')
    expect(setFiatDisplay).toHaveBeenCalledWith(true)
    expect(localStorage.getItem('arkade-vault-balance-unit')).toBe('usd')
    await user.click(hero)
    expect(hero).toHaveTextContent('₿128,000')
    expect(setFiatDisplay).toHaveBeenCalledWith(false)
  })

  it('keeps sats selected when the USD price is unavailable', async () => {
    const user = userEvent.setup()
    const setFiatDisplay = vi.fn().mockResolvedValue(null)
    renderHome({ fiatDisplayRate: null, setFiatDisplay })

    const hero = screen.getByTestId('vault-balance')
    await user.click(hero)

    expect(hero).toHaveTextContent('₿12,000')
    expect(localStorage.getItem('arkade-vault-balance-unit')).toBeNull()
    expect(await screen.findByText('USD balance is unavailable. Try again later.')).toBeTruthy()
  })

  it('shows total Spending balance even when some sats are still arriving', () => {
    renderHome({
      account: 'spend',
      positions: {
        spending: { availableSats: 80_000, pendingSats: 48_000, totalSats: 128_000 },
        savings: { availableSats: 0, pendingSats: 0, totalSats: 0 },
      },
    })
    expect(screen.queryByText('Available to spend')).toBeNull()
    expect(screen.getByTestId('vault-balance')).toHaveTextContent('₿128,000')
    expect(screen.getByTestId('spending-pending')).toHaveTextContent('48,000 sats arriving')
    expect(screen.queryByTestId('spending-total')).toBeNull()
    expect(screen.queryByText(/currently spendable/i)).toBeNull()
  })

  it('shows total Savings balance even when some sats are not yet spendable', () => {
    renderHome({
      account: 'savings',
      positions: {
        spending: { availableSats: 0, pendingSats: 0, totalSats: 0 },
        savings: { availableSats: 20_000, pendingSats: 30_000, totalSats: 50_000 },
      },
    })
    expect(screen.getByTestId('vault-balance')).toHaveTextContent('₿50,000')
    expect(screen.queryByText(/currently spendable/i)).toBeNull()
  })

  it('shows the current account without a picker on Home', () => {
    renderHome({ account: 'spend' })
    expect(screen.getByTestId('account-switcher')).toHaveTextContent('Spending')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByTestId('account-spend')).toBeNull()
    expect(screen.queryByTestId('account-savings')).toBeNull()
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

  it('does not show a background refresh failure over a known balance', () => {
    renderHome({
      balanceError: 'Something went wrong. Try again.',
      balancesLoaded: true,
      error: 'Something went wrong. Try again.',
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull()
  })
})

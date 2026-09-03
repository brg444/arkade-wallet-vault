import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultNavigation from './Navigation'

function renderNav(overrides: Partial<VaultContextProps> = {}) {
  const value = {
    account: 'spend',
    balancesLoaded: true,
    navigate: vi.fn(),
    positions: {
      spending: { availableSats: 80_000, pendingSats: 48_000, totalSats: 128_000 },
      savings: { availableSats: 20_000, pendingSats: 30_000, totalSats: 50_000 },
    },
    setAccount: vi.fn(),
    ...overrides,
  } as unknown as VaultContextProps
  render(
    <VaultContext.Provider value={value}>
      <VaultNavigation />
    </VaultContext.Provider>,
  )
  return value
}

describe('Vault navigation', () => {
  it('opens a Home launcher and navigates without a tab bar', async () => {
    const user = userEvent.setup()
    const value = renderNav()
    const navigate = value.navigate

    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Spending' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Savings' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Security' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Wallet' })).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()

    const security = screen.getByRole('button', { name: 'Security' })
    security.focus()
    await user.keyboard('{Enter}')
    expect(navigate).toHaveBeenCalledWith('keys')
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus()
  })

  it('switches accounts from the launcher and stays on Home', async () => {
    const user = userEvent.setup()
    const value = renderNav()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByTestId('account-spend')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('account-spend')).toHaveTextContent('128,000 SATS')
    expect(screen.getByTestId('account-savings')).toHaveTextContent('50,000 SATS')

    await user.click(screen.getByTestId('account-savings'))
    expect(value.setAccount).toHaveBeenCalledWith('savings')
    expect(value.navigate).not.toHaveBeenCalled()
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
  })
})

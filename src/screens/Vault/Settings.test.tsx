import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultSettings from './Settings'

vi.mock('../../lib/vault/update', () => ({ reloadIfNewerWallet: () => Promise.resolve(false) }))

function renderSettings(overrides: Partial<VaultContextProps> = {}) {
  const value = {
    boardingAddress: 'tb1pboardingdestination',
    busy: false,
    liveNetwork: true,
    navigate: vi.fn(),
    refreshBalance: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    status: null,
    ...overrides,
  } as unknown as VaultContextProps
  render(
    <ToastProvider>
      <VaultContext.Provider value={value}>
        <VaultSettings />
      </VaultContext.Provider>
    </ToastProvider>,
  )
  return value
}

describe('Vault settings account boundaries', () => {
  afterEach(() => {
    localStorage.removeItem('arkade-vault-theme')
    document.documentElement.classList.remove('palette-dark')
  })

  it('does not expose test funding controls', () => {
    renderSettings()
    expect(screen.queryByTestId('settings-faucet')).toBeNull()
    expect(screen.queryByTestId('settings-hwsign')).toBeNull()
    expect(screen.getByTestId('settings-theme')).toHaveRole('button')
    expect(screen.getByTestId('settings-haptics')).toHaveRole('button')
    expect(screen.getByTestId('settings-about')).toHaveRole('button')
    expect(screen.getByTestId('settings-update')).toHaveRole('button')
    expect(screen.getByTestId('settings-refresh')).toHaveRole('button')
    expect(screen.getByTestId('settings-logs')).toHaveRole('button')
    expect(screen.getByTestId('settings-signout')).toHaveRole('button')
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Adjust this browser.' })).toBeTruthy()
    expect(screen.queryByText('General')).toBeTruthy()
    expect(document.querySelector('.qg-eyebrow')).toBeNull()
    expect(document.querySelector('.qg-methods')).toBeNull()
  })

  it('picks a theme from paper radios instead of the old select list', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.click(screen.getByTestId('settings-theme'))
    expect(screen.getByRole('heading', { name: 'Theme' })).toBeTruthy()
    const dark = screen.getByTestId('select-option-1')
    expect(dark).toHaveAttribute('role', 'radio')
    await user.click(dark)
    expect(dark).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.classList.contains('palette-dark')).toBe(true)
  })

  it('signs out from a Quiet Guardian confirmation sheet', async () => {
    const user = userEvent.setup()
    const value = renderSettings()

    await user.click(screen.getByTestId('settings-signout'))
    expect(screen.getByRole('heading', { name: 'Sign out of this browser.' })).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Sign out' })
    expect(confirm).toBeDisabled()
    await user.click(screen.getByTestId('checkbox'))
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(value.reset).toHaveBeenCalled()
  })
})

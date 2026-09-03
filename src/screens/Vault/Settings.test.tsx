import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultSettings from './Settings'

vi.mock('../../lib/vault/update', () => ({ reloadIfNewerWallet: () => Promise.resolve(false) }))

describe('Vault settings account boundaries', () => {
  it('does not expose test funding controls', () => {
    const value = {
      boardingAddress: 'tb1pboardingdestination',
      busy: false,
      liveNetwork: true,
      navigate: vi.fn(),
      refreshBalance: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      status: null,
    } as unknown as VaultContextProps
    render(
      <ToastProvider>
        <VaultContext.Provider value={value}>
          <VaultSettings />
        </VaultContext.Provider>
      </ToastProvider>,
    )

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
  })
})

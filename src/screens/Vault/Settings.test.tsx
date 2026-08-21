import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { VaultContext, type VaultContextProps } from '../../providers/vault'
import VaultSettings from './Settings'

vi.mock('../../lib/vault/update', () => ({ reloadIfNewerWallet: () => Promise.resolve(false) }))

describe('Vault settings account boundaries', () => {
  it('funds the boarding address instead of the retired operational address', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const value = {
      boardingAddress: 'tb1pboardingdestination',
      busy: false,
      faucetUrl: 'https://faucet.test/',
      liveNetwork: true,
      navigate: vi.fn(),
      operationalAddress: 'tb1poldoperationaladdress',
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

    await userEvent.click(screen.getByTestId('settings-faucet'))
    expect(open).toHaveBeenCalledWith(`${value.faucetUrl}?address=${value.boardingAddress}`, '_blank')
    expect(open).not.toHaveBeenCalledWith(expect.stringContaining(value.operationalAddress), '_blank')
  })
})

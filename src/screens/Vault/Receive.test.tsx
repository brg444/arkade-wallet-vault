import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { VaultContext, type VaultAccount, type VaultContextProps } from '../../providers/vault'
import VaultReceive from './Receive'

vi.mock('../../components/QrCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid='receive-qr'>{value}</div>,
}))

function renderReceive(account: VaultAccount) {
  const value = {
    account,
    boardingAddress: 'tb1qboarding',
    faucetUrl: 'https://faucet.test/',
    liveNetwork: true,
    navigate: () => {},
    savingsAddress: 'tb1qsavings',
    spendingArkAddress: 'tark1spending',
  } as VaultContextProps
  return render(
    <ToastProvider>
      <VaultContext.Provider value={value}>
        <VaultReceive />
      </VaultContext.Provider>
    </ToastProvider>,
  )
}

describe('Vault receive', () => {
  it('shows one Spending BIP21 request with Arkade and boarding addresses', () => {
    renderReceive('spend')
    expect(screen.getByTestId('receive-qr').textContent).toBe('bitcoin:tb1qboarding?ark=tark1spending')
    expect(screen.getByTestId('receive-arkade-address')).toBeTruthy()
    expect(screen.getByTestId('receive-bitcoin-address')).toBeTruthy()
    expect(screen.queryByText('Savings')).toBeNull()
  })

  it('keeps Savings receive separate when entered from Savings', () => {
    renderReceive('savings')
    expect(screen.getByTestId('receive-qr').textContent).toBe('tb1qsavings')
    expect(screen.getByText('Savings')).toBeTruthy()
    expect(screen.queryByTestId('receive-arkade-address')).toBeNull()
    expect(screen.queryByTestId('receive-bitcoin-address')).toBeNull()
  })
})

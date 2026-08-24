import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { VaultContext, type VaultAccount, type VaultContextProps } from '../../vault/context'
import VaultReceive from './Receive'

vi.mock('../../components/QrCode', () => ({
  default: ({ value }: { value: string }) => <div data-testid='receive-qr'>{value}</div>,
}))

function renderReceive(account: VaultAccount) {
  const value = {
    account,
    boardingAddress: 'tb1qboarding',
    liveNetwork: true,
    navigate: () => {},
    savingsAddress: 'tb1qsavings',
    spendingArkAddress: 'tark1spending',
  } as unknown as VaultContextProps
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
    expect(screen.getByRole('heading', { name: 'Receive to Spending' })).toBeTruthy()
    expect(screen.getByTestId('receive-qr').textContent).toBe('bitcoin:tb1qboarding?ark=tark1spending')
    expect(screen.queryByTestId('receive-address')).toBeNull()
    expect(screen.getByTestId('receive-arkade-address')).toBeTruthy()
    expect(screen.getByTestId('receive-bitcoin-address')).toBeTruthy()
    expect(screen.queryByText('Savings')).toBeNull()
  })

  it('keeps Savings receive separate when entered from Savings', () => {
    renderReceive('savings')
    expect(screen.getByRole('heading', { name: 'Add to Savings' })).toBeTruthy()
    expect(screen.getByTestId('receive-qr').textContent).toBe('tb1qsavings')
    expect(screen.getByTestId('receive-address')).toHaveTextContent('tb1qsavings')
    expect(screen.getByText('Savings address')).toBeTruthy()
    expect(screen.queryByTestId('receive-arkade-address')).toBeNull()
    expect(screen.queryByTestId('receive-bitcoin-address')).toBeNull()
  })
})

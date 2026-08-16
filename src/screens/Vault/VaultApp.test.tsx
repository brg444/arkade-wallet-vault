import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { DEMO_HARDWARE_PUB, DEMO_RECOVERY_PUB } from '../../lib/vault/setup'
import { VaultProvider } from '../../providers/vault'
import VaultApp from '../../VaultApp'

function renderVault() {
  window.localStorage.clear()
  return render(
    <ToastProvider>
      <VaultProvider>
        <VaultApp />
      </VaultProvider>
    </ToastProvider>,
  )
}

describe('VaultApp onboarding', () => {
  it('requires hardware, recovery, and rules before the wallet home', async () => {
    const user = userEvent.setup()
    renderVault()

    expect(await screen.findByText('A vault, not a hot wallet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Look around first' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Set up this vault' }))

    expect(await screen.findByText('How it is built')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'I understand — continue' }))

    expect(await screen.findByText('Hardware path')).toBeTruthy()
    fireEvent.change(screen.getByTestId('hardware-pub'), { target: { value: DEMO_HARDWARE_PUB } })
    await user.click(screen.getByRole('button', { name: 'I control this key' }))

    expect(await screen.findByText('Recovery key')).toBeTruthy()
    fireEvent.change(screen.getByTestId('recovery-pub'), { target: { value: DEMO_RECOVERY_PUB } })
    await user.click(screen.getByRole('button', { name: 'I control this key' }))

    expect(await screen.findByText('Spending rules')).toBeTruthy()
    await user.click(screen.getByTestId('cap-20000'))
    await user.click(screen.getByTestId('daily-50000'))
    await user.click(screen.getByRole('button', { name: 'Save these rules' }))

    expect(await screen.findByText('Your vault plan')).toBeTruthy()
    expect(screen.getByText('20,000 SATS per payment')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Looks right — continue' }))

    expect(await screen.findByText('Phone passkey')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Enter without a passkey' }))

    expect(await screen.findByText('Spending')).toBeTruthy()
    expect(screen.getByTestId('vault-balance').textContent).toMatch(/^0/)
    expect(screen.getByText(/not on a chain/i)).toBeTruthy()
    expect(screen.getByText(/Phone may spend/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /This phone Daily spending/i }))
    expect(await screen.findByText('Keys')).toBeTruthy()
    expect(screen.getByText(/Vault service/)).toBeTruthy()
    expect(screen.getByText(/Today, from this phone/)).toBeTruthy()
  })
})

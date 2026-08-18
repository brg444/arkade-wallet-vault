import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { DEMO_HARDWARE_PUB } from '../../lib/vault/setupPlan'
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
  it('requires hardware and rules before the wallet home', async () => {
    const user = userEvent.setup()
    renderVault()

    expect(await screen.findByText('Your vault')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Look around first' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Set up' }))

    expect(await screen.findByText('How it works')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Which hardware?')).toBeTruthy()
    fireEvent.change(screen.getByTestId('hardware-pub'), { target: { value: DEMO_HARDWARE_PUB } })
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Recovery key')).toBeTruthy()
    expect(screen.getByText(/optional paper key/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(await screen.findByText('How much can this device send?')).toBeTruthy()
    await user.click(screen.getByTestId('cap-20000'))
    await user.click(screen.getByTestId('daily-50000'))
    await user.click(screen.getByRole('button', { name: 'Save these rules' }))

    expect(await screen.findByText('Review')).toBeTruthy()
    expect(screen.getByText('20,000 SATS per send')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Passkey')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(screen.getByTestId('vault-balance').textContent).toMatch(/^0/)
    expect(screen.getByTestId('account-scan')).toBeTruthy()
    expect(screen.getByTestId('account-receive')).toBeTruthy()
    expect(screen.getByTestId('account-switcher').textContent).toMatch(/Spending/)
    expect(screen.getByText(/not on a chain/i)).toBeTruthy()
    expect(screen.getByText(/0 \/ 50,000 available/)).toBeTruthy()

    await user.click(screen.getByTestId('account-switcher'))
    expect(await screen.findByTestId('account-savings')).toBeTruthy()
    await user.click(screen.getByTestId('account-savings'))
    expect(screen.getByTestId('account-switcher').textContent).toMatch(/Savings/)
    expect(screen.queryByText(/0 \/ 50,000 available/)).toBeNull()
    expect(screen.getByText(/start a hold/i)).toBeTruthy()

    await user.click(screen.getByTestId('account-switcher'))
    await user.click(await screen.findByTestId('account-spend'))
    expect(screen.getByText(/0 \/ 50,000 available/)).toBeTruthy()
    expect(screen.queryByText(/Phone may spend/)).toBeNull()
    expect(screen.queryByText(/Open Mutinynet faucet/)).toBeNull()
    expect(screen.queryByText(/Daily path ready/)).toBeNull()

    await user.click(screen.getByTestId('tab-vault'))
    expect(await screen.findByText('Keys')).toBeTruthy()
    expect(screen.getByText(/Vault service/)).toBeTruthy()
    expect(screen.getByText(/Daily spend/)).toBeTruthy()
    expect(screen.getByText('Recovery')).toBeTruthy()

    await user.click(screen.getByTestId('tab-settings'))
    expect(await screen.findByText('Theme')).toBeTruthy()
    expect(screen.getByText('Haptics')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.getByText('Recover')).toBeTruthy()
    expect(screen.getByText('Recovery Kit')).toBeTruthy()
    expect(screen.getByText('Check for update')).toBeTruthy()
    expect(screen.getByText('Logs')).toBeTruthy()
    expect(screen.getByText('Reset')).toBeTruthy()
    expect(screen.queryByText('Backup')).toBeNull()
    expect(screen.queryByText('Fiat')).toBeNull()

    await user.click(screen.getByTestId('settings-about'))
    expect(await screen.findByText('Site')).toBeTruthy()
    await user.click(screen.getByLabelText('Go back'))

    await user.click(await screen.findByTestId('settings-reset'))
    expect(await screen.findByText('Sign out of this browser')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveProperty('disabled', true)
    expect(screen.queryByText('Your vault')).toBeNull()
  })
})

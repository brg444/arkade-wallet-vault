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

    expect(await screen.findByText('Add hardware')).toBeTruthy()
    fireEvent.change(screen.getByTestId('hardware-pub'), { target: { value: DEMO_HARDWARE_PUB } })
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('button', { name: 'Skip for now' })).toBeTruthy()
    expect(screen.getByText(/waiting period/i)).toBeTruthy()
    expect(screen.getByText(/Optional/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(await screen.findByText('Daily limits')).toBeTruthy()
    expect(screen.getByText(/How much this device can send today/)).toBeTruthy()
    await user.click(screen.getByTestId('cap-20000'))
    await user.click(screen.getByTestId('daily-50000'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Your setup')).toBeTruthy()
    expect(screen.getByText('20,000 SATS per send')).toBeTruthy()
    expect(screen.getByText('Skipped. This device plus hardware only.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(/This is this device/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(screen.getByTestId('vault-balance').textContent).toMatch(/^0/)
    expect(screen.getByTestId('vault-history').textContent).toMatch(/No transactions yet/)
    expect(screen.getByTestId('account-scan')).toBeTruthy()
    expect(screen.getByTestId('account-receive')).toBeTruthy()
    expect(screen.getByTestId('account-switcher').textContent).toMatch(/Spending/)
    expect(screen.getByText(/not funded yet/i)).toBeTruthy()
    expect(screen.getByText(/0 \/ 50,000 available/)).toBeTruthy()

    await user.click(screen.getByTestId('account-switcher'))
    expect(await screen.findByTestId('account-savings')).toBeTruthy()
    await user.click(screen.getByTestId('account-savings'))
    expect(screen.getByTestId('account-switcher').textContent).toMatch(/Savings/)
    expect(screen.queryByText(/0 \/ 50,000 available/)).toBeNull()
    expect(screen.getByText(/Hardware signs too/)).toBeTruthy()

    await user.click(screen.getByTestId('account-switcher'))
    await user.click(await screen.findByTestId('account-spend'))
    expect(screen.getByText(/0 \/ 50,000 available/)).toBeTruthy()
    expect(screen.queryByText(/Phone may spend/)).toBeNull()
    expect(screen.queryByText(/Open Mutinynet faucet/)).toBeNull()
    expect(screen.queryByText(/Daily path ready/)).toBeNull()

    await user.click(screen.getByTestId('tab-vault'))
    expect(await screen.findByRole('tab', { name: 'Security' })).toBeTruthy()
    expect(screen.getByText('Vault service')).toBeTruthy()
    expect(screen.getByText('Recovery Kit')).toBeTruthy()
    expect(screen.getByText('I lost a key')).toBeTruthy()
    expect(screen.queryByText('Recovery')).toBeNull()
    expect(screen.queryByText(/Daily spend/)).toBeNull()
    expect(screen.queryByText(/If you lose one/i)).toBeNull()

    await user.click(screen.getByTestId('tab-settings'))
    expect(await screen.findByText('Theme')).toBeTruthy()
    expect(screen.getByText('Haptics')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.queryByText('Recover')).toBeNull()
    expect(screen.queryByText('Recovery Kit')).toBeNull()
    expect(screen.getByText('Check for update')).toBeTruthy()
    expect(screen.getByText('Logs')).toBeTruthy()
    expect(screen.getByText('Sign out')).toBeTruthy()
    expect(screen.queryByText('Backup')).toBeNull()
    expect(screen.queryByText('Fiat')).toBeNull()

    await user.click(screen.getByTestId('settings-about'))
    expect(await screen.findByText('Site')).toBeTruthy()
    await user.click(screen.getByLabelText('Go back'))

    await user.click(await screen.findByTestId('settings-signout'))
    expect(await screen.findByText('Sign out of this browser')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveProperty('disabled', true)
    expect(screen.queryByText('Your vault')).toBeNull()
  })
})

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
  it('requires hardware, rules, and a passkey enrollment before the wallet home', async () => {
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
    expect(screen.getByRole('button', { name: 'Create this device' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    expect(screen.queryByTestId('vault-balance')).toBeNull()
  }, 20_000)
})

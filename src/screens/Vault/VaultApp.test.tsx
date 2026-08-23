import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { PROGRAM_FIXTURE } from '../../lib/vault/program/fixtures'
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

    expect(await screen.findByText('Spending and Savings, together')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Look around first' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Set up a new vault' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sign in to an existing vault/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Set up a new vault' }))

    expect(await screen.findByRole('heading', { name: 'How it works' })).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: 'Vault setup progress' })).toHaveAttribute('aria-valuenow', '1')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Add hardware' })).toBeTruthy()
    fireEvent.change(screen.getByTestId('hardware-pub'), { target: { value: PROGRAM_FIXTURE.hardwarePub } })
    await user.click(screen.getByRole('button', { name: 'Use this hardware key' }))

    expect(await screen.findByRole('button', { name: 'Skip for now' })).toBeTruthy()
    expect(screen.getByText(/waiting period/i)).toBeTruthy()
    expect(screen.getByText(/Optional/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(await screen.findByRole('heading', { name: 'Daily limits' })).toBeTruthy()
    expect(screen.getByText(/limits are set by the Vault Program/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Review setup' }))

    expect(await screen.findByRole('heading', { name: 'Your setup' })).toBeTruthy()
    expect(screen.getByText('50,000 SATS per send')).toBeTruthy()
    expect(screen.getByText('Skipped. This device plus hardware only.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Secure this device' }))

    expect(await screen.findByText(/Set this up on the phone or computer/)).toBeTruthy()
    expect(screen.getByTestId('enrollment-token')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Secure this device' })).toBeTruthy()
    expect(screen.getByTestId('passkey-unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    expect(screen.queryByTestId('vault-balance')).toBeNull()
  }, 20_000)
})

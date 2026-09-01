import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => vi.unstubAllGlobals())

describe('VaultApp onboarding', () => {
  it('requires hardware, rules, and a passkey enrollment before the wallet home', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('blockchain.info')
          ? new Response(JSON.stringify({ USD: { last: 100_000 } }), { status: 200 })
          : new Response('{}', { status: 503 }),
      ),
    )
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

    expect(await screen.findByRole('heading', { name: 'Protection' })).toBeTruthy()
    expect(screen.getByTestId('protection-standard')).toBeTruthy()
    expect(screen.getByTestId('protection-advanced')).toBeTruthy()
    expect(screen.queryByTestId('recovery-pub')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Use Standard' }))

    expect(await screen.findByRole('heading', { name: 'Spending limits' })).toBeTruthy()
    expect(screen.getByText(/Above-limit payments are refused/i)).toBeTruthy()
    expect(screen.getByTestId('policy-preset-lower-exposure')).toBeTruthy()
    expect(screen.getByTestId('policy-preset-everyday')).toBeTruthy()
    expect(screen.getByTestId('policy-preset-custom')).toBeTruthy()
    expect(screen.queryByTestId('policy-fee-cap')).toBeNull()
    expect(screen.queryByTestId('policy-feerate-cap')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show approximate USD' }))
    expect((await screen.findAllByText(/approximately \$50\.00/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/about 1 hour/)).not.toHaveLength(0)
    expect(screen.getAllByText(/about 1 day/)).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Review setup' }))

    expect(await screen.findByRole('heading', { name: 'Your setup' })).toBeTruthy()
    expect(screen.getAllByText(/50,000 SATS per payment/).length).toBeGreaterThan(0)
    expect(screen.getByText('Not enrolled with Standard.')).toBeTruthy()
    expect(screen.getAllByText(/approximately \$50\.00/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/about 1 hour/)).not.toHaveLength(0)
    expect(screen.getAllByText(/about 1 day/)).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Secure this device' }))

    expect(await screen.findByText(/Set this up on the phone or computer/)).toBeTruthy()
    expect(screen.getByTestId('enrollment-token')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Secure this device' })).toBeTruthy()
    expect(screen.getByTestId('passkey-unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    expect(screen.queryByTestId('vault-balance')).toBeNull()
  }, 20_000)

  it('requires a recovery key for Advanced and reviews its consequence', async () => {
    const user = userEvent.setup()
    renderVault()
    await user.click(await screen.findByRole('button', { name: 'Set up a new vault' }))
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByTestId('hardware-pub'), {
      target: { value: PROGRAM_FIXTURE.hardwarePub },
    })
    await user.click(screen.getByRole('button', { name: 'Use this hardware key' }))

    await user.click(await screen.findByTestId('protection-advanced'))
    expect(screen.getByRole('button', { name: 'Use Advanced' })).toBeDisabled()
    fireEvent.change(screen.getByTestId('recovery-pub'), { target: { value: PROGRAM_FIXTURE.recoveryPub } })
    await user.click(screen.getByRole('button', { name: 'Use Advanced' }))
    await user.click(await screen.findByRole('button', { name: 'Review setup' }))

    expect(await screen.findByText(/Advanced protection/)).toBeTruthy()
    expect(screen.getByText(/separate recovery key is required/i)).toBeTruthy()
    expect(screen.getByText(/Required for Advanced/)).toBeTruthy()
  }, 20_000)
})

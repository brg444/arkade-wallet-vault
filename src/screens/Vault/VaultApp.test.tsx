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

    expect(await screen.findByRole('heading', { name: /Spend freely/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Look around first' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Get started' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Sign in to an existing vault/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Get started' }))

    expect(await screen.findByRole('heading', { name: 'Different money needs different protection' })).toBeTruthy()
    expect(screen.getByTestId('screen-title')).toHaveTextContent('How it works')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Add your hardware key' })).toBeTruthy()
    fireEvent.change(screen.getByTestId('hardware-pub'), { target: { value: PROGRAM_FIXTURE.hardwarePub } })
    await user.click(screen.getByRole('button', { name: 'Use this hardware key' }))

    expect(await screen.findByRole('heading', { name: 'How should recovery work?' })).toBeTruthy()
    expect(screen.getByTestId('protection-standard')).toBeTruthy()
    expect(screen.getByTestId('protection-advanced')).toBeTruthy()
    expect(screen.queryByTestId('recovery-pub')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Continue with Standard' }))

    expect(await screen.findByRole('heading', { name: 'Set comfortable limits' })).toBeTruthy()
    expect(screen.getByTestId('policy-tx-cap')).toBeTruthy()
    expect(screen.getByTestId('policy-period-allowance')).toBeTruthy()
    expect(screen.queryByTestId('policy-fee-cap')).toBeNull()
    expect(screen.queryByTestId('policy-feerate-cap')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Review setup' }))

    expect(await screen.findByRole('heading', { name: 'Review your Vault' })).toBeTruthy()
    expect(screen.getByText('₿50,000')).toBeTruthy()
    expect(screen.getByText('Not enrolled')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { name: 'Create your passkey' })).toBeTruthy()
    expect(screen.getByTestId('enrollment-token')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create Vault' })).toBeTruthy()
    expect(screen.getByTestId('passkey-unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    expect(screen.queryByTestId('vault-balance')).toBeNull()
  }, 20_000)

  it('requires a recovery key for Advanced and reviews its consequence', async () => {
    const user = userEvent.setup()
    renderVault()
    await user.click(await screen.findByRole('button', { name: 'Get started' }))
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    fireEvent.change(await screen.findByTestId('hardware-pub'), {
      target: { value: PROGRAM_FIXTURE.hardwarePub },
    })
    await user.click(screen.getByRole('button', { name: 'Use this hardware key' }))

    await user.click(await screen.findByTestId('protection-advanced'))
    expect(screen.getByRole('button', { name: 'Continue with Advanced' })).toBeDisabled()
    fireEvent.change(screen.getByTestId('recovery-pub'), { target: { value: PROGRAM_FIXTURE.recoveryPub } })
    await user.click(screen.getByRole('button', { name: 'Continue with Advanced' }))
    await user.click(await screen.findByRole('button', { name: 'Review setup' }))

    expect(await screen.findByText('Advanced')).toBeTruthy()
    expect(screen.getByText('Recovery key')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  }, 20_000)
})

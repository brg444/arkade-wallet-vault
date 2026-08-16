import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from '../../components/Toast'
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

describe('VaultApp non-developer flow', () => {
  it('walks welcome to receive and a preview send', async () => {
    const user = userEvent.setup()
    renderVault()

    expect(await screen.findByText('Daily spending vault')).toBeTruthy()
    expect(screen.queryByLabelText('Vault descriptor JSON')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Look around first' }))

    expect(await screen.findByText('Spending')).toBeTruthy()
    expect(screen.getByTestId('vault-balance').textContent).toMatch(/SATS/)

    await user.click(screen.getByRole('button', { name: 'Receive' }))
    expect(await screen.findByText(/do not send real bitcoin/i)).toBeTruthy()
    expect(screen.getByTestId('receive-address').textContent).toMatch(/^bcrt1/)

    await user.click(screen.getByLabelText('Go back'))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.change(screen.getByPlaceholderText('Bitcoin address'), {
      target: { value: 'bcrt1p40xfaupmdqysq0c6m5m6q0c6m5m6q0c6m5m6q0c6m5m6q0c6m5mq7n0d2p' },
    })
    fireEvent.change(screen.getByTestId('vault-send-amount'), { target: { value: '20000' } })
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Review')).toBeTruthy()
    expect(screen.getByText('20,000 SATS')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Looks good' }))
    expect(await screen.findByText('Preview only — nothing left this device.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Spending')).toBeTruthy()
  })
})

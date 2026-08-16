import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { sampleDescriptor } from '../../lib/vault/sample'
import { VaultProvider } from '../../providers/vault'
import VaultApp from '../../VaultApp'

function renderVault() {
  return render(
    <ToastProvider>
      <VaultProvider>
        <VaultApp />
      </VaultProvider>
    </ToastProvider>,
  )
}

describe('VaultApp watch-only shell', () => {
  it('imports a v3 descriptor and shows receive', async () => {
    const user = userEvent.setup()
    window.localStorage.clear()
    renderVault()

    expect(screen.getByText('Vault mode')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Vault descriptor JSON'), {
      target: { value: JSON.stringify(sampleDescriptor()) },
    })
    await user.click(screen.getByRole('button', { name: 'Import descriptor' }))

    expect(await screen.findByText('Operational vault')).toBeTruthy()
    expect(screen.getByText(sampleDescriptor().operational.address)).toBeTruthy()
    expect(screen.getByText(sampleDescriptor().savings.address)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Receive' }))
    expect(await screen.findByText('Receive')).toBeTruthy()
    expect(screen.getByText(sampleDescriptor().operational.address)).toBeTruthy()
  })
})

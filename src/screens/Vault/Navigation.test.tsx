import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultNavigation from './Navigation'

describe('Vault navigation', () => {
  it('opens a Home launcher and navigates without a tab bar', async () => {
    const user = userEvent.setup()
    const navigate = vi.fn()
    render(
      <VaultContext.Provider value={{ navigate } as unknown as VaultContextProps}>
        <VaultNavigation />
      </VaultContext.Provider>,
    )

    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Security' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Receive' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Wallet' })).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()

    const security = screen.getByRole('button', { name: 'Security' })
    security.focus()
    await user.keyboard('{Enter}')
    expect(navigate).toHaveBeenCalledWith('keys')
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveFocus()
  })
})

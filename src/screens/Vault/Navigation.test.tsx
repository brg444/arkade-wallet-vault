import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultNavigation from './Navigation'

describe('Vault navigation', () => {
  it('uses ordinary navigation with the current page identified', async () => {
    const user = userEvent.setup()
    const navigate = vi.fn()
    render(
      <VaultContext.Provider value={{ navigate } as unknown as VaultContextProps}>
        <VaultNavigation active='wallet' />
      </VaultContext.Provider>,
    )

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Wallet' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Security' })).not.toHaveAttribute('aria-current')
    expect(screen.queryByRole('tab')).toBeNull()

    const security = screen.getByRole('button', { name: 'Security' })
    security.focus()
    await user.keyboard('{Enter}')
    expect(navigate).toHaveBeenCalledWith('keys')
  })
})

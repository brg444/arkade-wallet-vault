import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Header from './Header'

describe('Vault Header', () => {
  it('uses named native buttons with keyboard activation', async () => {
    const user = userEvent.setup()
    const back = vi.fn()
    const clear = vi.fn()
    render(<Header text='Logs' back={back} auxText='Clear' auxFunc={clear} />)

    const backButton = screen.getByRole('button', { name: 'Go back' })
    const clearButton = screen.getByRole('button', { name: 'Clear' })
    backButton.focus()
    await user.keyboard('{Enter}')
    clearButton.focus()
    await user.keyboard(' ')

    expect(back).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('exposes disabled auxiliary actions', () => {
    render(<Header text='Logs' auxText='Clear' />)
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
  })
})

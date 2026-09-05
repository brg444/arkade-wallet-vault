import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InstallNotice from './InstallNotice'

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false
      this.dispatchEvent(new Event('close'))
    },
  })
})

afterEach(() => {
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

function offerInstall(prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>) {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.assign(event, { prompt })
  act(() => window.dispatchEvent(event))
  return event
}

describe('Welcome installation notice', () => {
  it('hides in an installed app, including iOS standalone mode', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    const first = render(<InstallNotice />)
    expect(screen.queryByRole('button', { name: /Install Vaulted/ })).toBeNull()
    first.unmount()
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    try {
      render(<InstallNotice />)
      expect(screen.queryByRole('button', { name: /Install Vaulted/ })).toBeNull()
    } finally {
      delete (navigator as Navigator & { standalone?: boolean }).standalone
    }
  })

  it('shows iPhone installation steps only when requested and permits dismissal', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone')
    render(<InstallNotice />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Install Vaulted/ }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('Add to Home Screen')).toBeVisible()
    expect(within(sheet).getByText('Open as Web App')).toBeVisible()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Continue in browser' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: /Install Vaulted/ })).toBeVisible()
  })

  it('opens the native offer directly and respects cancellation before accepting a fresh offer', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Android')
    render(<InstallNotice />)
    const prompt = vi.fn().mockResolvedValue({ outcome: 'dismissed' })
    expect(offerInstall(prompt).defaultPrevented).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Install Vaulted/ }))
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: /Install Vaulted/ })).toBeEnabled())
    expect(screen.queryByRole('dialog')).toBeNull()

    // Only another explicit request opens manual steps after the event is consumed.
    fireEvent.click(screen.getByRole('button', { name: /Install Vaulted/ }))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('Add to Home screen')).toBeVisible()
    expect(prompt).toHaveBeenCalledTimes(1)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Continue in browser' }))
    const retry = vi.fn().mockResolvedValue({ outcome: 'accepted' })
    offerInstall(retry)
    fireEvent.click(screen.getByRole('button', { name: /Install Vaulted/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Install Vaulted/ })).toBeEnabled())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('does not invoke the native prompt again while it is open', async () => {
    render(<InstallNotice />)
    let resolve!: (choice: { outcome: 'dismissed' }) => void
    const prompt = vi.fn(() => new Promise<{ outcome: 'dismissed' }>((done) => (resolve = done)))
    offerInstall(prompt)
    const trigger = screen.getByRole('button', { name: /Install Vaulted/ })
    fireEvent.click(trigger)
    expect(trigger).toBeDisabled()
    fireEvent.click(trigger)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => resolve({ outcome: 'dismissed' }))
    expect(trigger).toBeEnabled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('handles an unavailable native prompt and hides after the browser confirms installation', async () => {
    render(<InstallNotice />)
    offerInstall(vi.fn().mockRejectedValue(new Error('unavailable')))
    fireEvent.click(screen.getByRole('button', { name: /Install Vaulted/ }))
    await screen.findByRole('status')
    act(() => window.dispatchEvent(new Event('appinstalled')))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: /Install Vaulted/ })).toBeNull()
  })
})

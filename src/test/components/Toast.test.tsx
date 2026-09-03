import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { toast, ToastProvider } from '../../components/Toast'

describe('ToastProvider', () => {
  it('keeps top notifications below mobile display cutouts', async () => {
    render(
      <ToastProvider>
        <div />
      </ToastProvider>,
    )
    toast('Saved')

    const toaster = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[data-sonner-toaster]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    expect(toaster.style.getPropertyValue('--mobile-offset-top')).toBe(
      'max(16px, calc(var(--vault-safe-area-top, 0px) + 12px))',
    )
  })
})

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useIntentPress } from './useIntentPress'

function Harness({ scope = 'home', action }: { scope?: string; action: () => void }) {
  const press = useIntentPress(scope)
  return (
    <div {...press}>
      <section>
        <button onClick={action}>Action</button>
        <input aria-label='Destination' />
      </section>
    </div>
  )
}

function pointer(target: HTMLElement, type: string, x = 30, y = 30) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  act(() => target.dispatchEvent(event))
}

function click(target: HTMLElement) {
  fireEvent.click(target, { detail: 1, clientX: 30, clientY: 30 })
}

describe('intentional activation', () => {
  it('accepts a small amount of finger movement and cancels a drag', () => {
    const action = vi.fn()
    render(<Harness action={action} />)
    const button = screen.getByRole('button')
    pointer(button, 'pointerdown')
    pointer(button, 'pointermove', 34, 33)
    pointer(button, 'pointerup', 34, 33)
    click(button)
    expect(action).toHaveBeenCalledOnce()
    pointer(button, 'pointerdown')
    pointer(button, 'pointermove', 30, 60)
    pointer(button, 'pointerup', 30, 60)
    click(button)
    expect(action).toHaveBeenCalledOnce()
  })

  it('preserves native field clicks after selection drags and repeated taps', () => {
    render(<Harness action={vi.fn()} />)
    const input = screen.getByRole('textbox')
    pointer(input, 'pointerdown')
    pointer(input, 'pointermove', 90, 30)
    pointer(input, 'pointerup', 90, 30)
    expect(fireEvent.click(input, { detail: 1 })).toBe(true)
    pointer(input, 'pointerdown')
    pointer(input, 'pointerup')
    expect(fireEvent.click(input, { detail: 2 })).toBe(true)
  })

  it('accepts the native touch sequence when the pointer leaves after release', () => {
    const action = vi.fn()
    render(<Harness action={action} />)
    const button = screen.getByRole('button')
    pointer(button, 'pointerdown')
    pointer(button, 'pointerup')
    fireEvent.pointerOut(button, { relatedTarget: null })
    click(button)
    expect(action).toHaveBeenCalledOnce()
  })

  it('discards cancelled and cross-screen releases but preserves keyboard activation', () => {
    const action = vi.fn()
    const { rerender } = render(<Harness action={action} />)
    const button = screen.getByRole('button')
    pointer(button, 'pointerdown')
    pointer(button, 'pointercancel')
    click(button)
    expect(action).not.toHaveBeenCalled()
    pointer(button, 'pointerdown')
    rerender(<Harness scope='send' action={action} />)
    pointer(button, 'pointerup')
    click(button)
    expect(action).not.toHaveBeenCalled()
    fireEvent.click(button, { detail: 0 })
    expect(action).toHaveBeenCalledOnce()
  })

  it('blocks a repeated tap at the same spot only while the next screen is settling', () => {
    const action = vi.fn()
    const { rerender } = render(<Harness action={action} />)
    const button = screen.getByRole('button')
    pointer(button, 'pointerdown')
    pointer(button, 'pointerup')
    click(button)
    rerender(<Harness scope='send' action={action} />)
    const animations = vi.fn().mockReturnValue([{ playState: 'running' }])
    Object.defineProperty(button.parentElement, 'getAnimations', { configurable: true, value: animations })
    pointer(button, 'pointerdown')
    pointer(button, 'pointerup')
    click(button)
    expect(action).toHaveBeenCalledOnce()
    animations.mockReturnValue([])
    pointer(button, 'pointerdown')
    pointer(button, 'pointerup')
    click(button)
    expect(action).toHaveBeenCalledTimes(2)
  })
})

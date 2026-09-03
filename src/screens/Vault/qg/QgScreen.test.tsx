import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QgScreen from './QgScreen'

describe('QgScreen input viewport lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the focused field visible on keyboard resize and stops after blur', () => {
    const listeners = new Map<string, EventListener>()
    vi.stubGlobal('visualViewport', {
      height: 420,
      addEventListener(name: string, listener: EventListener) {
        listeners.set(name, listener)
      },
      removeEventListener(name: string) {
        listeners.delete(name)
      },
    })
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const scrollIntoView = vi.fn()
    const scrollBy = vi.fn()

    render(
      <QgScreen title='Send' footer={<button>Review</button>}>
        <input aria-label='To' />
      </QgScreen>,
    )
    const input = screen.getByLabelText('To')
    const main = screen.getByRole('main')
    Object.defineProperty(input, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    Object.defineProperty(input, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 390, bottom: 440 }),
    })
    Object.defineProperty(main, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 60, bottom: 410 }),
    })
    Object.defineProperty(main, 'scrollBy', { configurable: true, value: scrollBy })
    act(() => input.focus())
    listeners.get('resize')?.(new Event('resize'))
    act(() => frames.splice(0).forEach((callback) => callback(0)))
    expect(scrollBy).toHaveBeenCalledWith({ top: 42, behavior: 'smooth' })
    expect(scrollIntoView).not.toHaveBeenCalled()

    scrollBy.mockClear()
    act(() => input.blur())
    listeners.get('resize')?.(new Event('resize'))
    act(() => frames.splice(0).forEach((callback) => callback(0)))
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('cancels a queued focus scroll when the screen unmounts', () => {
    vi.stubGlobal('visualViewport', { addEventListener() {}, removeEventListener() {} })
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const { unmount } = render(
      <QgScreen title='Send'>
        <input aria-label='To' />
      </QgScreen>,
    )
    fireEvent.focus(screen.getByLabelText('To'))
    unmount()
    expect(cancel).toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyVaultFrameHeight, bootVaultFrame, currentVaultFrameHeight } from './pwaFrame'

describe('vault PWA frame', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--vault-frame-height')
    vi.unstubAllGlobals()
  })

  it('uses the visual viewport when the keyboard has shortened the canvas', () => {
    vi.stubGlobal('visualViewport', { height: 420, addEventListener() {}, removeEventListener() {} })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812 })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 874 })
    expect(currentVaultFrameHeight()).toBe(420)
  })

  it('covers the physical screen when the keyboard is closed so the iOS safe area is painted', () => {
    vi.stubGlobal('visualViewport', { height: 812, addEventListener() {}, removeEventListener() {} })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812 })
    Object.defineProperty(window.screen, 'height', { configurable: true, value: 874 })
    expect(currentVaultFrameHeight()).toBe(874)
  })

  it('does not pin a desktop frame height', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('max-width') ? false : false,
        addEventListener() {},
        removeEventListener() {},
      })),
    )
    applyVaultFrameHeight()
    expect(document.documentElement.style.getPropertyValue('--vault-frame-height')).toBe('')
  })

  it('coalesces keyboard viewport changes into one animation frame and cancels cleanup work', () => {
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
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} }),
    )
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(++nextFrame, callback)
      return nextFrame
    })
    const cancel = vi.fn((id: number) => callbacks.delete(id))
    vi.stubGlobal('cancelAnimationFrame', cancel)

    const dispose = bootVaultFrame()
    listeners.get('resize')?.(new Event('resize'))
    listeners.get('resize')?.(new Event('resize'))
    expect(callbacks.size).toBe(1)
    dispose()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(listeners.has('resize')).toBe(false)
  })
})

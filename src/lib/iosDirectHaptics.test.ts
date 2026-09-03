import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bootDirectIOSHaptics,
  needsDirectIOSHaptics,
  resetDirectIOSHapticsForTest,
  setDirectIOSHapticsEnabled,
} from './iosDirectHaptics'

describe('direct iOS haptics', () => {
  afterEach(() => {
    resetDirectIOSHapticsForTest()
    document.body.replaceChildren()
    Reflect.deleteProperty(document, 'elementFromPoint')
    Reflect.deleteProperty(navigator, 'userAgent')
    Reflect.deleteProperty(navigator, 'platform')
    Reflect.deleteProperty(navigator, 'maxTouchPoints')
    Reflect.deleteProperty(navigator, 'vibrate')
    vi.restoreAllMocks()
  })

  it('uses direct switch taps on supported iOS WebKit releases', () => {
    expect(
      needsDirectIOSHaptics(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        'iPhone',
        5,
        false,
      ),
    ).toBe(true)
    expect(
      needsDirectIOSHaptics(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        'iPhone',
        5,
        false,
      ),
    ).toBe(true)
    expect(
      needsDirectIOSHaptics(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        'iPhone',
        5,
        false,
      ),
    ).toBe(false)
    expect(
      needsDirectIOSHaptics('Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140', 'Linux', 5, true),
    ).toBe(false)
  })

  it('places a direct native switch over a button and forwards its activation', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    })
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'iPhone' })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined })

    const onClick = vi.fn()
    const button = document.createElement('button')
    button.addEventListener('click', onClick)
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      bottom: 68,
      height: 48,
      left: 20,
      right: 180,
      top: 20,
      width: 160,
      x: 20,
      y: 20,
      toJSON: () => ({}),
    })
    document.body.appendChild(button)
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(button),
    })

    expect(bootDirectIOSHaptics()).toBe(true)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const overlay = document.querySelector<HTMLInputElement>('#vault-ios-haptic-overlays input[switch]')
    expect(overlay).toBeTruthy()
    expect(overlay?.style.pointerEvents).toBe('auto')
    overlay?.click()
    expect(onClick).toHaveBeenCalledOnce()

    setDirectIOSHapticsEnabled(false)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(overlay?.style.display).toBe('none')
  })
})

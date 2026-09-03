import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyVaultFrameHeight, currentVaultFrameHeight } from './pwaFrame'

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

  it('fills the physical screen when the keyboard is closed', () => {
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
})

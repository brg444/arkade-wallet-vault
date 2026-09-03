import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootHaptics, hapticLight, hapticSubtle, hapticTap, setHapticsEnabled } from './haptics'

describe('vault haptics', () => {
  beforeEach(() => {
    setHapticsEnabled(true)
    document.body.replaceChildren()
    vi.spyOn(HTMLLabelElement.prototype, 'click')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('clicks an on-screen iOS switch so Taptic Engine can fire', () => {
    hapticLight()
    const input = document.querySelector('input[switch]') as HTMLInputElement | null
    const label = document.querySelector('label[for="qg-haptic-switch"]') as HTMLLabelElement | null
    expect(input).toBeTruthy()
    expect(label).toBeTruthy()
    expect(input?.style.display).not.toBe('none')
    expect(label?.style.display).not.toBe('none')
    expect(HTMLLabelElement.prototype.click).toHaveBeenCalled()
  })

  it('reuses the same switch after boot', () => {
    bootHaptics()
    hapticSubtle()
    hapticTap()
    expect(document.querySelectorAll('input[switch]')).toHaveLength(1)
  })

  it('stays quiet when haptics are off', () => {
    setHapticsEnabled(false)
    hapticLight()
    expect(HTMLLabelElement.prototype.click).not.toHaveBeenCalled()
  })
})

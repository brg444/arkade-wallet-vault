import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const trigger = vi.fn().mockResolvedValue(undefined)

vi.mock('web-haptics', () => ({
  WebHaptics: vi.fn(function WebHaptics() {
    return { trigger }
  }),
}))

describe('vault haptics', () => {
  beforeEach(() => {
    trigger.mockClear()
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('uses Arkade wallet light and selection patterns', async () => {
    const { hapticLight, hapticSubtle, hapticTap } = await import('./haptics')
    hapticLight()
    hapticSubtle()
    hapticTap()
    expect(trigger).toHaveBeenNthCalledWith(1, 'light')
    expect(trigger).toHaveBeenNthCalledWith(2, 'selection')
    expect(trigger).toHaveBeenNthCalledWith(3, 'selection')
  })

  it('stays quiet when haptics are off or reduced motion is preferred', async () => {
    const { hapticLight, setHapticsEnabled } = await import('./haptics')
    setHapticsEnabled(false)
    hapticLight()
    expect(trigger).not.toHaveBeenCalled()

    setHapticsEnabled(true)
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    hapticLight()
    expect(trigger).not.toHaveBeenCalled()
  })
})

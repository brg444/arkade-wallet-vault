import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLauncherPosition } from './useLauncherPosition'
import { launcherCoast, launcherReleaseVelocity } from './launcherMomentum'

vi.mock('../../../lib/haptics', () => ({ hapticSubtle: vi.fn() }))

const KEY = 'vault-launcher-position-v3'
let now = 0
let frames: Map<number, FrameRequestCallback>
let frameId = 0
let reduced = false
const open = vi.fn()

function Harness() {
  const layer = useRef<HTMLDivElement>(null)
  const position = useLauncherPosition(layer, () => {}, open)
  return (
    <div ref={layer}>
      <button onPointerDown={position.onPointerDown} onClick={position.onClick} onKeyDown={position.onKeyDown}>
        Launcher
      </button>
    </div>
  )
}
function pointer(target: EventTarget, type: string, y: number, time: number) {
  now = time + 1000
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 390, clientY: y, button: 0 })
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, timeStamp: { value: now } })
  act(() => {
    target.dispatchEvent(event)
  })
}
function frame(time: number) {
  now = time + 1000
  const pending = [...frames.values()]
  frames.clear()
  act(() => {
    pending.forEach((callback) => callback(now))
  })
}
function top(tab: HTMLElement) {
  return (
    parseFloat(tab.parentElement!.style.getPropertyValue('--qg-launcher-y')) +
    (parseFloat(tab.style.getPropertyValue('--qg-launcher-drag-y')) || 0)
  )
}
function flick(tab: HTMLElement) {
  pointer(tab, 'pointerdown', 640, 0)
  pointer(window, 'pointermove', 600, 20)
  pointer(window, 'pointermove', 520, 60)
  frame(60)
  pointer(window, 'pointerup', 500, 70)
}

beforeEach(() => {
  localStorage.clear()
  now = 0
  reduced = false
  frames = new Map()
  open.mockClear()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++frameId, callback)
    return frameId
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id)
  })
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
  )
})

describe('launcher momentum', () => {
  it('coasts after release, slows down, stays inside bounds and persists the settled position', () => {
    const { unmount } = render(<Harness />)
    const tab = screen.getByRole('button')
    flick(tab)
    const release = top(tab)
    expect(tab).toHaveClass('is-coasting')
    frame(110)
    const first = top(tab)
    frame(150)
    const second = top(tab)
    expect(first).toBeLessThan(release)
    expect(first - second).toBeLessThan(release - first)
    frame(1400)
    const settled = top(tab)
    expect(settled).toBeGreaterThanOrEqual(16)
    expect(tab).not.toHaveClass('is-coasting')
    expect(Number(localStorage.getItem(KEY))).toBeGreaterThanOrEqual(0)
    expect(open).not.toHaveBeenCalled()
    unmount()
    render(<Harness />)
    expect(top(screen.getByRole('button'))).toBeCloseTo(settled)
  })

  it('catches a moving tab without a jump or accidental menu opening', () => {
    render(<Harness />)
    const tab = screen.getByRole('button')
    flick(tab)
    frame(130)
    const caught = top(tab)
    pointer(tab, 'pointerdown', caught + 20, 135)
    expect(top(tab)).toBeCloseTo(caught)
    expect(tab).not.toHaveClass('is-coasting')
    pointer(window, 'pointerup', caught + 20, 180)
    fireEvent.click(tab, { detail: 1 })
    expect(open).not.toHaveBeenCalled()
    frame(800)
    expect(top(tab)).toBeCloseTo(caught)
    pointer(tab, 'pointerdown', caught + 20, 900)
    pointer(window, 'pointerup', caught + 20, 950)
    fireEvent.click(tab, { detail: 1 })
    expect(open).toHaveBeenCalledOnce()
  })

  it('holds precise placement when paused before release or reduced motion is enabled', () => {
    const { unmount } = render(<Harness />)
    let tab = screen.getByRole('button')
    pointer(tab, 'pointerdown', 640, 0)
    pointer(window, 'pointermove', 500, 50)
    frame(50)
    const held = top(tab)
    pointer(window, 'pointerup', 500, 250)
    expect(tab).not.toHaveClass('is-coasting')
    expect(top(tab)).toBe(held)
    unmount()
    reduced = true
    render(<Harness />)
    tab = screen.getByRole('button')
    flick(tab)
    expect(tab).not.toHaveClass('is-coasting')
    const placed = top(tab)
    frame(800)
    expect(top(tab)).toBe(placed)
  })

  it('cancels a drag without saving or starting momentum', () => {
    render(<Harness />)
    const tab = screen.getByRole('button')
    const start = top(tab)
    pointer(tab, 'pointerdown', 640, 0)
    pointer(window, 'pointermove', 500, 50)
    frame(50)
    pointer(window, 'pointercancel', 500, 60)
    frame(400)
    expect(top(tab)).toBe(start)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(tab).not.toHaveClass('is-coasting')
  })

  it('follows the final direction of a flick and saves its position when the page leaves', () => {
    render(<Harness />)
    const tab = screen.getByRole('button')
    pointer(tab, 'pointerdown', 640, 0)
    pointer(window, 'pointermove', 560, 20)
    pointer(window, 'pointermove', 500, 40)
    pointer(window, 'pointermove', 520, 60)
    pointer(window, 'pointerup', 540, 80)
    const release = top(tab)
    frame(120)
    expect(top(tab)).toBeGreaterThan(release)
    const leaving = top(tab)
    fireEvent(window, new Event('pagehide'))
    frame(800)
    expect(top(tab)).toBeCloseTo(leaving)
    expect(localStorage.getItem(KEY)).not.toBeNull()
    expect(tab).not.toHaveClass('is-coasting')
  })

  it('stops on resize, keeps keyboard placement available and cleans up animation', () => {
    const { unmount } = render(<Harness />)
    const tab = screen.getByRole('button')
    flick(tab)
    frame(100)
    const current = top(tab)
    fireEvent(window, new Event('resize'))
    expect(tab).not.toHaveClass('is-coasting')
    expect(top(tab)).toBeCloseTo(current)
    fireEvent.keyDown(tab, { key: 'ArrowDown', altKey: true })
    expect(top(tab)).toBeCloseTo(current + 32)
    flick(tab)
    unmount()
    expect(frames.size).toBe(0)
  })

  it('uses recent movement and never overshoots either edge at different frame rates', () => {
    expect(
      launcherReleaseVelocity(
        [
          { y: 644, time: 1096 },
          { y: 620, time: 1147 },
          { y: 620, time: 1201 },
        ],
        1201,
      ),
    ).toBeLessThan(-0.2)
    expect(
      launcherReleaseVelocity(
        [
          { y: 200, time: 0 },
          { y: 100, time: 20 },
          { y: 100, time: 200 },
        ],
        200,
      ),
    ).toBe(0)
    expect(launcherCoast(200, 0.05, 16, 600)).toBeNull()
    for (const velocity of [-4, 4]) {
      const sample = launcherCoast(300, velocity, 16, 600)!
      for (const interval of [8.33, 16.67, 33.33]) {
        for (let time = 0; time <= 1300; time += interval) {
          expect(sample(time).y).toBeGreaterThanOrEqual(16)
          expect(sample(time).y).toBeLessThanOrEqual(600)
        }
      }
      expect(sample(1300)).toEqual({ y: velocity < 0 ? 16 : 600, done: true })
    }
  })
})

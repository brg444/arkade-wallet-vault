import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { hapticSubtle } from '../../../lib/haptics'

const KEY = 'vault-launcher-position-v3'
const HEIGHT = 72
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, max), Math.max(min, value))

function readPosition() {
  try {
    const value = localStorage.getItem(KEY)
    if (value === null || value.trim() === '') return null
    const ratio = Number(value)
    return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : null
  } catch {
    return null
  }
}

/** One captured gesture: tap to open, vertical drag to place, left pull to peek. */
export function useLauncherPosition(
  layer: RefObject<HTMLDivElement>,
  setPull: (progress: number) => void,
  open: () => void,
) {
  const ratio = useRef(readPosition())
  const y = useRef(0)
  const [upper, setUpper] = useState(false)
  const cancel = useRef<() => void>(() => {})
  const suppressClick = useRef(false)

  const bounds = () => {
    const element = layer.current
    const style = element ? getComputedStyle(element) : null
    const height = element?.getBoundingClientRect().height || window.innerHeight
    const min = parseFloat(style?.paddingTop || '') || 16
    const inset = parseFloat(style?.paddingBottom || '') || 16
    return { min, max: Math.max(min, height - HEIGHT - inset), height, inset }
  }
  const place = (next: number) => {
    y.current = next
    layer.current?.style.setProperty('--qg-launcher-y', `${next}px`)
    setUpper(next + HEIGHT / 2 < bounds().height / 2)
  }

  useLayoutEffect(() => {
    const resize = () => {
      cancel.current()
      const { min, max, height, inset } = bounds()
      place(
        ratio.current === null
          ? clamp(height - HEIGHT - Math.max(52, inset + 12), min, max)
          : min + ratio.current * (max - min),
      )
    }
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    if (layer.current) observer?.observe(layer.current)
    window.addEventListener('resize', resize)
    return () => {
      cancel.current()
      observer?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return
    cancel.current()
    const button = event.currentTarget
    const id = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    const startTop = y.current
    const limits = bounds()
    let axis: 'vertical' | 'horizontal' | null = null
    let next = startTop
    let travel = 0
    let frame = 0
    let active = true
    suppressClick.current = false
    try {
      button.setPointerCapture(id)
    } catch {
      // Window listeners retain the gesture when a browser declines capture.
    }

    const paint = () => {
      frame = 0
      button.style.setProperty('--qg-launcher-drag-y', `${next - startTop}px`)
    }
    const finish = (commit: boolean) => {
      if (!active) return
      active = false
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', interrupted)
      window.removeEventListener('blur', interrupted)
      button.removeEventListener('lostpointercapture', interrupted)
      button.classList.remove('is-repositioning')
      if (axis === 'vertical' && commit) {
        place(next)
        ratio.current = limits.max === limits.min ? 0 : (next - limits.min) / (limits.max - limits.min)
        try {
          localStorage.setItem(KEY, String(ratio.current))
        } catch {
          // Placement remains available when storage is disabled.
        }
        hapticSubtle()
      }
      button.style.removeProperty('--qg-launcher-drag-y')
      if (!commit) suppressClick.current = true
      if (axis === 'horizontal' && commit && travel >= 52) open()
      else setPull(0)
      if (button.hasPointerCapture?.(id)) button.releasePointerCapture(id)
    }
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== id) return
      const dx = pointer.clientX - startX
      const dy = pointer.clientY - startY
      if (!axis) {
        if (Math.hypot(dx, dy) < 8) return
        if (Math.abs(dy) >= Math.abs(dx)) axis = 'vertical'
        else if (dx < -12 && -dx > Math.abs(dy) * 1.25) axis = 'horizontal'
        else {
          // Ambiguous motion waits for a direction without turning into a tap.
          suppressClick.current = true
          return
        }
        suppressClick.current = true
        if (axis === 'vertical') button.classList.add('is-repositioning')
      }
      pointer.preventDefault()
      if (axis === 'vertical') {
        next = clamp(startTop + dy, limits.min, limits.max)
        if (!frame) frame = requestAnimationFrame(paint)
      } else {
        travel = Math.max(0, -dx)
        setPull(Math.min(1, travel / 96))
      }
    }
    const up = (pointer: PointerEvent) => {
      if (pointer.pointerId !== id) return
      move(pointer)
      finish(true)
    }
    const interrupted = (pointer: Event) => {
      if ('pointerId' in pointer && pointer.pointerId !== id) return
      finish(false)
    }
    cancel.current = () => finish(false)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', interrupted)
    window.addEventListener('blur', interrupted)
    button.addEventListener('lostpointercapture', interrupted)
  }

  return {
    upper,
    onPointerDown,
    onClick(event: React.MouseEvent<HTMLButtonElement>) {
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault()
        suppressClick.current = false
        return
      }
      open()
    },
    onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const { min, max } = bounds()
      place(clamp(y.current + (event.key === 'ArrowUp' ? -32 : 32), min, max))
      ratio.current = max === min ? 0 : (y.current - min) / (max - min)
      try {
        localStorage.setItem(KEY, String(ratio.current))
      } catch {
        /* Optional preference. */
      }
    },
  }
}

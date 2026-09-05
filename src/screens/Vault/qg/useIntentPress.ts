import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

const SLOP = 10
const PRESS_DELAY = 60
const REPEAT_WINDOW = 280
const editable =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), textarea, [contenteditable="true"]'
const controls = 'button, a[href], input[type="checkbox"], input[type="radio"], [role="button"]'

function control(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>(controls) : null
}

/** Keep scrolling, cancelled pointers and taps carried across a screen change out of click handlers. */
export function useIntentPress(scope: string) {
  const pointer = useRef<{
    id: number
    x: number
    y: number
    target: HTMLElement | null
    scope: string
    cancelled: boolean
    settling: boolean
    released: boolean
  } | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout>>()
  const last = useRef({ scope: '', time: 0, x: 0, y: 0 })

  const clearPress = () => {
    clearTimeout(pressTimer.current)
    pointer.current?.target?.removeAttribute('data-intent-pressed')
  }
  useEffect(() => () => clearPress(), [])

  return {
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      clearPress()
      if (event.isPrimary === false || event.button !== 0) {
        if (pointer.current) pointer.current.cancelled = true
        return
      }
      const target = control(event.target)
      pointer.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target,
        scope,
        cancelled: false,
        released: false,
        settling:
          event.currentTarget.firstElementChild
            ?.getAnimations?.()
            .some((animation) => animation.playState === 'running') ?? false,
      }
      if (!target || target.matches(':disabled, [aria-disabled="true"]')) return
      pressTimer.current = setTimeout(() => target.setAttribute('data-intent-pressed', ''), PRESS_DELAY)
    },
    onPointerMoveCapture(event: PointerEvent<HTMLDivElement>) {
      const start = pointer.current
      if (!start || start.id !== event.pointerId) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= SLOP) return
      start.cancelled = true
      clearPress()
    },
    onPointerCancelCapture() {
      if (pointer.current) pointer.current.cancelled = true
      clearPress()
    },
    onPointerLeave() {
      // Touch pointers leave the surface after pointerup, before the browser emits click.
      if (pointer.current && !pointer.current.released) pointer.current.cancelled = true
      clearPress()
    },
    onPointerUpCapture(event: PointerEvent<HTMLDivElement>) {
      const start = pointer.current
      if (!start || start.id !== event.pointerId) return
      start.released = true
      const hit = document.elementFromPoint?.(event.clientX, event.clientY)
      if (hit && start.target && !start.target.contains(hit)) start.cancelled = true
      clearPress()
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      // Native fields need unrestricted caret placement, selection and repeated taps.
      if (event.target instanceof Element && event.target.closest(editable)) return
      const target = control(event.target)
      if (event.detail === 0) return // Preserve keyboard and assistive activation.
      const start = pointer.current
      const previous = last.current
      const repeatedAcrossScreens =
        start?.settling &&
        previous.scope !== scope &&
        performance.now() - previous.time < REPEAT_WINDOW &&
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 24
      if (
        (start && (start.cancelled || start.scope !== scope || (target && start.target !== target))) ||
        repeatedAcrossScreens ||
        event.detail > 1
      ) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (target) last.current = { scope, time: performance.now(), x: event.clientX, y: event.clientY }
    },
  }
}

const OVERLAY_HOST_ID = 'vault-ios-haptic-overlays'

type IOSVersion = {
  major: number
  minor: number
}

function iosVersion(userAgent: string): IOSVersion | null {
  const match = userAgent.match(/(?:CPU (?:iPhone )?OS|iPhone OS) (\d+)(?:[_\.](\d+))?/i)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
  }
}

export function needsDirectIOSHaptics(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
  hasVibrationAPI: boolean,
): boolean {
  if (hasVibrationAPI) return false
  const appleTouchDevice = /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
  if (!appleTouchDevice || !/AppleWebKit/i.test(userAgent)) return false

  const version = iosVersion(userAgent)
  if (!version) return true
  return version.major > 17 || (version.major === 17 && version.minor >= 4)
}

function directIOSHapticsRequired(): boolean {
  if (typeof navigator === 'undefined') return false
  return needsDirectIOSHaptics(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
    typeof navigator.vibrate === 'function',
  )
}

let enabled = true
let active = false
let host: HTMLDivElement | null = null
let mutationObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null
let reducedMotion: MediaQueryList | null = null
let frame = 0
const overlays = new Map<HTMLButtonElement, HTMLInputElement>()

function scheduleLayout(): void {
  if (!active || frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    syncOverlays()
  })
}

function removeOverlay(button: HTMLButtonElement): void {
  const overlay = overlays.get(button)
  if (!overlay) return
  resizeObserver?.unobserve(button)
  overlay.remove()
  overlays.delete(button)
}

function addOverlay(button: HTMLButtonElement): void {
  if (!host || overlays.has(button)) return

  const overlay = document.createElement('input')
  overlay.type = 'checkbox'
  overlay.setAttribute('switch', '')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.tabIndex = -1
  overlay.className = 'vault-ios-haptic-overlay'
  Object.assign(overlay.style, {
    all: 'initial',
    appearance: 'auto',
    border: '0',
    margin: '0',
    opacity: '0',
    padding: '0',
    position: 'fixed',
    zIndex: '2147483647',
  })

  overlay.addEventListener('click', (event) => {
    event.stopPropagation()
    if (!enabled || button.disabled || !button.isConnected) return
    button.click()
  })
  overlay.addEventListener('pointerdown', () => button.setAttribute('data-haptic-pressed', ''))
  const clearPressed = () => button.removeAttribute('data-haptic-pressed')
  overlay.addEventListener('pointerup', clearPressed)
  overlay.addEventListener('pointercancel', clearPressed)

  overlays.set(button, overlay)
  host.appendChild(overlay)
  resizeObserver?.observe(button)
}

function isRendered(button: HTMLButtonElement): boolean {
  if (!enabled || button.disabled || button.hidden || !button.isConnected) return false
  if (reducedMotion?.matches) return false
  const style = getComputedStyle(button)
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
}

function syncOverlays(): void {
  if (!host) return

  const buttons = new Set(document.querySelectorAll<HTMLButtonElement>('button'))
  for (const button of overlays.keys()) {
    if (!buttons.has(button)) removeOverlay(button)
  }
  for (const button of buttons) addOverlay(button)

  for (const overlay of overlays.values()) overlay.style.pointerEvents = 'none'

  for (const [button, overlay] of overlays) {
    const rect = button.getBoundingClientRect()
    const left = Math.max(0, rect.left)
    const top = Math.max(0, rect.top)
    const right = Math.min(window.innerWidth, rect.right)
    const bottom = Math.min(window.innerHeight, rect.bottom)
    const width = Math.max(0, right - left)
    const height = Math.max(0, bottom - top)

    if (!isRendered(button) || width < 1 || height < 1) {
      overlay.style.display = 'none'
      continue
    }

    const target = document.elementFromPoint(left + width / 2, top + height / 2)
    if (target !== button && !button.contains(target)) {
      overlay.style.display = 'none'
      continue
    }

    overlay.style.display = 'block'
    overlay.style.left = `${left}px`
    overlay.style.top = `${top}px`
    overlay.style.width = `${width}px`
    overlay.style.height = `${height}px`
    overlay.style.borderRadius = getComputedStyle(button).borderRadius
    overlay.style.pointerEvents = 'auto'
  }
}

export function setDirectIOSHapticsEnabled(value: boolean): void {
  enabled = value
  scheduleLayout()
}

export function bootDirectIOSHaptics(): boolean {
  if (active) return true
  if (typeof document === 'undefined' || typeof window === 'undefined' || !directIOSHapticsRequired()) return false

  active = true
  host = document.createElement('div')
  host.id = OVERLAY_HOST_ID
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.inset = '0'
  host.style.pointerEvents = 'none'
  host.style.zIndex = '2147483647'
  document.body.appendChild(host)

  resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleLayout)
  mutationObserver = new MutationObserver((mutations) => {
    if (host && mutations.every((mutation) => host?.contains(mutation.target))) return
    scheduleLayout()
  })
  mutationObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'disabled', 'hidden', 'style'],
    childList: true,
    subtree: true,
  })

  reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  reducedMotion?.addEventListener?.('change', scheduleLayout)
  window.addEventListener('resize', scheduleLayout)
  window.addEventListener('scroll', scheduleLayout, true)
  window.visualViewport?.addEventListener('resize', scheduleLayout)
  window.visualViewport?.addEventListener('scroll', scheduleLayout)
  scheduleLayout()
  return true
}

export function directIOSHapticsActive(): boolean {
  return active
}

export function resetDirectIOSHapticsForTest(): void {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  mutationObserver?.disconnect()
  mutationObserver = null
  resizeObserver?.disconnect()
  resizeObserver = null
  reducedMotion?.removeEventListener?.('change', scheduleLayout)
  reducedMotion = null
  window.removeEventListener('resize', scheduleLayout)
  window.removeEventListener('scroll', scheduleLayout, true)
  window.visualViewport?.removeEventListener('resize', scheduleLayout)
  window.visualViewport?.removeEventListener('scroll', scheduleLayout)
  for (const button of overlays.keys()) removeOverlay(button)
  host?.remove()
  host = null
  active = false
  enabled = true
}

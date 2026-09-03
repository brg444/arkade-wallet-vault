import { WebHaptics } from 'web-haptics'

let enabled = true
let haptics: WebHaptics | null = null

export function setHapticsEnabled(value: boolean): void {
  enabled = value
}

function getHaptics(): WebHaptics | null {
  if (haptics) return haptics
  if (typeof window === 'undefined') return null
  try {
    haptics = new WebHaptics()
    return haptics
  } catch {
    return null
  }
}

function shouldSkipHaptics(): boolean {
  if (!enabled) return true
  if (typeof window === 'undefined') return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function triggerHaptic(pattern: 'selection' | 'light' | 'medium'): void {
  if (shouldSkipHaptics()) return
  void getHaptics()
    ?.trigger(pattern)
    .catch(() => undefined)
}

export function hapticTap(): void {
  triggerHaptic('selection')
}

export function hapticLight(): void {
  triggerHaptic('light')
}

export function hapticSubtle(): void {
  triggerHaptic('selection')
}

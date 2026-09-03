import { WebHaptics } from 'web-haptics'
import { bootDirectIOSHaptics, directIOSHapticsActive, setDirectIOSHapticsEnabled } from './iosDirectHaptics'

let enabled = true
let haptics: WebHaptics | null = null

export function setHapticsEnabled(value: boolean): void {
  enabled = value
  setDirectIOSHapticsEnabled(value)
}

function getHaptics(): WebHaptics | null {
  if (haptics) return haptics
  if (typeof window === 'undefined') return null
  haptics = new WebHaptics()
  return haptics
}

export function bootHaptics(): void {
  if (bootDirectIOSHaptics()) return
  getHaptics()
}

function shouldSkipHaptics(): boolean {
  if (!enabled) return true
  if (typeof window === 'undefined') return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function triggerHaptic(pattern: 'selection' | 'light' | 'medium'): void {
  if (shouldSkipHaptics()) return
  if (directIOSHapticsActive()) return
  getHaptics()
    ?.trigger(pattern)
    .catch(() => {})
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

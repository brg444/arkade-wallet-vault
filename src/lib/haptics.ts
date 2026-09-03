let enabled = true
let iosLabel: HTMLLabelElement | null = null

export function setHapticsEnabled(value: boolean): void {
  enabled = value
}

export function bootHaptics(): void {
  if (typeof document === 'undefined') return
  ensureSwitch()
}

function ensureSwitch(): HTMLLabelElement | null {
  if (iosLabel?.isConnected) return iosLabel
  if (typeof document === 'undefined') return null
  try {
    const id = 'qg-haptic-switch'
    document.getElementById(id)?.remove()
    document.querySelector(`label[for="${id}"]`)?.remove()

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.id = id
    input.setAttribute('switch', '')
    input.setAttribute('aria-hidden', 'true')
    input.tabIndex = -1
    Object.assign(input.style, {
      position: 'fixed',
      right: '8px',
      bottom: '8px',
      width: '32px',
      height: '20px',
      margin: '0',
      opacity: '0.01',
      pointerEvents: 'none',
      zIndex: '0',
    })

    const label = document.createElement('label')
    label.htmlFor = id
    label.setAttribute('aria-hidden', 'true')
    Object.assign(label.style, {
      position: 'fixed',
      right: '8px',
      bottom: '8px',
      width: '32px',
      height: '20px',
      margin: '0',
      opacity: '0.01',
      pointerEvents: 'none',
      zIndex: '0',
    })

    document.body.append(input, label)
    iosLabel = label
    return label
  } catch {
    return null
  }
}

function triggerHaptic(durationMs: number): void {
  if (!enabled) return
  if (typeof navigator === 'undefined') return
  ensureSwitch()?.click()
  navigator.vibrate?.(durationMs)
}

export function hapticTap(): void {
  triggerHaptic(12)
}

export function hapticLight(): void {
  triggerHaptic(15)
}

export function hapticSubtle(): void {
  triggerHaptic(8)
}

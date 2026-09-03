const FRAME_VAR = '--vault-frame-height'

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  )
}

function isMobileShell(): boolean {
  return window.matchMedia('(max-width: 899px)').matches
}

export function currentVaultFrameHeight(): number {
  const visual = window.visualViewport?.height ?? window.innerHeight
  const screenHeight = window.screen.height
  const keyboardOpen = visual < screenHeight * 0.75
  if (keyboardOpen) return Math.round(visual)
  return Math.round(Math.max(screenHeight, window.innerHeight, visual))
}

export function applyVaultFrameHeight(): void {
  const root = document.documentElement
  if (!isMobileShell()) {
    root.style.removeProperty(FRAME_VAR)
    return
  }
  if (!isStandalone() && !window.visualViewport) {
    root.style.setProperty(FRAME_VAR, '100vh')
    return
  }
  root.style.setProperty(FRAME_VAR, `${currentVaultFrameHeight()}px`)
}

export function bootVaultFrame(): () => void {
  let frame = 0
  const onChange = () => {
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      applyVaultFrameHeight()
    })
  }
  applyVaultFrameHeight()
  window.visualViewport?.addEventListener('resize', onChange)
  window.addEventListener('resize', onChange)
  window.addEventListener('orientationchange', onChange)
  window.addEventListener('pageshow', onChange)
  return () => {
    if (frame) window.cancelAnimationFrame(frame)
    window.visualViewport?.removeEventListener('resize', onChange)
    window.removeEventListener('resize', onChange)
    window.removeEventListener('orientationchange', onChange)
    window.removeEventListener('pageshow', onChange)
  }
}

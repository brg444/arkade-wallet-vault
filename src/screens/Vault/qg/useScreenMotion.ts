import { useLayoutEffect, useRef, type RefObject } from 'react'

export const SCREEN_DURATION = 240
export const SCREEN_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** Animate only the current screen; outgoing screens never retain live controls or effects. */
export function useScreenMotion(root: RefObject<HTMLDivElement>, scope: string) {
  const history = useRef<string[]>([scope])
  useLayoutEffect(() => {
    const previous = history.current.at(-1)
    if (previous === scope) return
    const index = history.current.indexOf(scope)
    const back = index >= 0
    history.current = back ? history.current.slice(0, index + 1) : [...history.current, scope].slice(-24)
    const node = root.current?.firstElementChild as HTMLElement | null
    if (!node?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const home = scope.startsWith('home:')
    const sheet = previous?.startsWith('home:') && node.classList.contains('is-sheet')
    const transform = home ? 'translateY(6px)' : sheet ? 'translateY(28px)' : `translateX(${back ? -16 : 20}px)`
    const animation = node.animate(
      [
        { opacity: 0.55, transform },
        { opacity: 1, transform: 'none' },
      ],
      { duration: SCREEN_DURATION, easing: SCREEN_EASE },
    )
    // A new gesture takes ownership immediately, without fighting an entrance animation.
    const settle = () => animation.cancel()
    node.addEventListener('pointerdown', settle, { once: true })
    return () => {
      node.removeEventListener('pointerdown', settle)
      animation.cancel()
    }
  }, [root, scope])
}

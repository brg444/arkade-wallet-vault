import { Landmark, Settings, Shield, Wallet, X } from 'lucide-react'
import HollowPixelMark from '../../icons/HollowPixelMark'
import { prettyNumber } from '../../lib/format'
import { hapticLight, hapticSubtle } from '../../lib/haptics'
import { useContext, useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { VaultContext, type VaultAccount, type VaultScreen } from '../../vault/context'

export type VaultDestination = 'wallet' | 'security' | 'settings'

export function destinationForScreen(screen: VaultScreen): VaultDestination | null {
  if (screen === 'home') return 'wallet'
  return null
}

const ACTIONS: { id: string; label: string; testId: string; icon: ReactNode; screen: VaultScreen }[] = [
  { id: 'security', label: 'Security', testId: 'tab-vault', icon: <Shield />, screen: 'keys' },
  { id: 'settings', label: 'Settings', testId: 'tab-settings', icon: <Settings />, screen: 'settings' },
]

const ACCOUNTS: { id: VaultAccount; label: string; testId: string; icon: ReactNode }[] = [
  { id: 'spend', label: 'Spending', testId: 'account-spend', icon: <Wallet /> },
  { id: 'savings', label: 'Savings', testId: 'account-savings', icon: <Landmark /> },
]

const LOCK = 8
const OPEN_DISTANCE = 52
const PEEK = 96
const LAUNCHER_POSITION_KEY = 'vault-launcher-position-v3'
const TRIGGER_HEIGHT = 72

function readLauncherPosition(): number | null {
  try {
    const value = window.localStorage.getItem(LAUNCHER_POSITION_KEY)
    if (value === null) return null
    const stored = Number(value)
    return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : null
  } catch {
    return null
  }
}

export default function VaultNavigation() {
  const { account, balancesLoaded, navigate, positions, setAccount } = useContext(VaultContext)
  const [open, setOpen] = useState(false)
  const [intro, setIntro] = useState(true)
  const [pull, setPull] = useState(0)
  const [launcherPosition, setLauncherPosition] = useState(readLauncherPosition)
  const launcherPositionRef = useRef(launcherPosition)
  const launcherRef = useRef<HTMLDivElement>(null)
  const positionFrame = useRef<number | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreTriggerFocus = useRef(false)
  const drag = useRef({
    startX: 0,
    startY: 0,
    dx: 0,
    active: false,
    axis: null as 'horizontal' | 'vertical' | null,
    suppressClick: false,
  })

  useEffect(() => {
    if (open || !restoreTriggerFocus.current) return
    restoreTriggerFocus.current = false
    triggerRef.current?.focus()
  }, [open])

  useEffect(
    () => () => {
      if (positionFrame.current !== null) window.cancelAnimationFrame(positionFrame.current)
    },
    [],
  )

  useEffect(() => {
    if (!open) return
    const collapse = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      restoreTriggerFocus.current = true
      setOpen(false)
    }
    window.addEventListener('keydown', collapse)
    return () => window.removeEventListener('keydown', collapse)
  }, [open])

  const close = () => {
    hapticSubtle()
    restoreTriggerFocus.current = false
    setPull(0)
    setOpen(false)
  }

  const openLauncher = () => {
    setIntro(false)
    setPull(0)
    setOpen(true)
  }

  const select = (screen: VaultScreen) => {
    hapticLight()
    setOpen(false)
    navigate(screen)
  }

  const chooseAccount = (next: VaultAccount) => {
    hapticSubtle()
    setAccount(next)
    restoreTriggerFocus.current = true
    setOpen(false)
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Older WebKit builds can reject capture while a pointer is becoming active.
    }
    setIntro(false)
    hapticLight()
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      active: true,
      axis: null,
      suppressClick: false,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active) return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    if (!drag.current.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= LOCK) return
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.current.axis = 'vertical'
      } else if (dx < 0) {
        drag.current.axis = 'horizontal'
      } else {
        drag.current.active = false
        return
      }
      drag.current.suppressClick = true
      event.currentTarget.classList.add('is-dragging')
    }

    if (drag.current.axis === 'vertical') {
      event.preventDefault()
      const nextPosition = Math.min(1, Math.max(0, event.clientY - TRIGGER_HEIGHT / 2) / window.innerHeight)
      launcherPositionRef.current = nextPosition
      launcherRef.current?.classList.toggle('is-upper', nextPosition < 0.5)
      if (positionFrame.current === null) {
        positionFrame.current = window.requestAnimationFrame(() => {
          launcherRef.current?.style.setProperty(
            '--qg-launcher-position',
            `${(launcherPositionRef.current ?? nextPosition) * 100}dvh`,
          )
          positionFrame.current = null
        })
      }
      return
    }
    const travel = Math.max(0, -dx)
    drag.current.dx = -travel
    setPull(Math.min(1, travel / PEEK))
  }

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active) return
    const axis = drag.current.axis
    const opened = axis === 'horizontal' && -drag.current.dx >= OPEN_DISTANCE
    drag.current.active = false
    drag.current.axis = null
    event.currentTarget.classList.remove('is-dragging')
    if (axis === 'vertical') {
      if (positionFrame.current !== null) {
        window.cancelAnimationFrame(positionFrame.current)
        positionFrame.current = null
      }
      setLauncherPosition(launcherPositionRef.current)
      try {
        window.localStorage.setItem(LAUNCHER_POSITION_KEY, String(launcherPositionRef.current))
      } catch {
        // Position persistence is optional when storage is unavailable.
      }
    }
    if (opened) {
      openLauncher()
      return
    }
    setPull(0)
  }

  const progress = open ? 1 : pull
  const peeking = !open && pull > 0
  const positionStyle = (
    launcherPosition === null ? undefined : { '--qg-launcher-position': `${launcherPosition * 100}dvh` }
  ) as CSSProperties | undefined
  const launcherClassName = [
    'qg-launcher',
    open ? 'is-open' : peeking ? 'is-peeking' : '',
    launcherPosition !== null && launcherPosition < 0.5 ? 'is-upper' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const stack = (
    <nav
      className='qg-launcher-stack'
      aria-label='Main navigation'
      id='vault-main-navigation'
      style={peeking ? { transform: `translateX(${Math.round((1 - progress) * 72)}px)` } : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      {ACCOUNTS.map((item) => {
        const position = item.id === 'spend' ? positions.spending : positions.savings
        const on = account === item.id
        return (
          <button
            key={item.id}
            type='button'
            className={on ? 'qg-launcher-item is-on' : 'qg-launcher-item'}
            onClick={() => chooseAccount(item.id)}
            aria-label={item.label}
            aria-pressed={on}
            data-testid={item.testId}
            tabIndex={open ? undefined : -1}
          >
            <span className='qg-launcher-copy'>
              <span className='qg-launcher-label'>{item.label}</span>
              <span className='qg-launcher-amt'>
                {balancesLoaded
                  ? `${prettyNumber(position.totalSats)} ${position.totalSats === 1 ? 'SAT' : 'SATS'}`
                  : 'Loading…'}
              </span>
            </span>
            <span className='qg-launcher-icon' aria-hidden='true'>
              {item.icon}
            </span>
          </button>
        )
      })}
      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type='button'
          className='qg-launcher-item'
          onClick={() => select(action.screen)}
          aria-label={action.label}
          data-testid={action.testId}
          tabIndex={open ? undefined : -1}
        >
          <span className='qg-launcher-label'>{action.label}</span>
          <span className='qg-launcher-icon' aria-hidden='true'>
            {action.icon}
          </span>
        </button>
      ))}
      <button
        type='button'
        className='qg-launcher-close vault-navigation-close'
        aria-label='Close navigation'
        onClick={close}
        tabIndex={open ? undefined : -1}
      >
        <X />
      </button>
    </nav>
  )

  return (
    <div ref={launcherRef} className={launcherClassName} style={positionStyle}>
      {open || peeking ? (
        <div
          className='qg-launcher-backdrop'
          onClick={open ? close : undefined}
          style={peeking ? { opacity: progress, pointerEvents: 'none' } : undefined}
        >
          {stack}
        </div>
      ) : null}
      {open ? null : (
        <button
          ref={triggerRef}
          type='button'
          className={[
            'qg-launcher-trigger vault-navigation-trigger',
            intro ? 'is-intro' : '',
            peeking ? 'is-pulling' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label='Open navigation'
          aria-expanded={open}
          aria-controls='vault-main-navigation'
          style={peeking ? { transform: `translateX(${Math.round(-progress * 28)}px)` } : undefined}
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.animationName.includes('qg-launcher-pulse')) setIntro(false)
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onPointerUp}
          onClick={(event) => {
            if (drag.current.suppressClick) {
              event.preventDefault()
              drag.current.suppressClick = false
              return
            }
            openLauncher()
          }}
        >
          <span className='qg-launcher-mark' aria-hidden='true'>
            <HollowPixelMark />
          </span>
        </button>
      )}
    </div>
  )
}

import { Landmark, Settings, Shield, Wallet, X } from 'lucide-react'
import HollowPixelMark from '../../icons/HollowPixelMark'
import { prettyNumber } from '../../lib/format'
import { hapticLight, hapticSubtle } from '../../lib/haptics'
import { useContext, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
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

export default function VaultNavigation() {
  const { account, balancesLoaded, navigate, positions, setAccount } = useContext(VaultContext)
  const [open, setOpen] = useState(false)
  const [intro, setIntro] = useState(true)
  const [pull, setPull] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreTriggerFocus = useRef(false)
  const drag = useRef({
    startX: 0,
    startY: 0,
    dx: 0,
    active: false,
    locked: false,
    suppressClick: false,
  })

  useEffect(() => {
    if (open || !restoreTriggerFocus.current) return
    restoreTriggerFocus.current = false
    triggerRef.current?.focus()
  }, [open])

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
    if (event.button) return
    setIntro(false)
    hapticLight()
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      active: true,
      locked: false,
      suppressClick: false,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current.active) return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    if (!drag.current.locked) {
      if (Math.abs(dy) > LOCK && Math.abs(dy) > Math.abs(dx)) {
        drag.current.active = false
        setPull(0)
        return
      }
      if (dx > -LOCK) return
      drag.current.locked = true
      drag.current.suppressClick = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    const travel = Math.max(0, -dx)
    drag.current.dx = -travel
    setPull(Math.min(1, travel / PEEK))
  }

  const onPointerUp = () => {
    if (!drag.current.active) return
    const opened = drag.current.locked && -drag.current.dx >= OPEN_DISTANCE
    drag.current.active = false
    drag.current.locked = false
    if (opened) {
      openLauncher()
      return
    }
    setPull(0)
  }

  const progress = open ? 1 : pull
  const peeking = !open && pull > 0

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
    <div className={open ? 'qg-launcher is-open' : peeking ? 'qg-launcher is-peeking' : 'qg-launcher'}>
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

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import BackIcon from '../../../icons/Back'
import { hapticLight } from '../../../lib/haptics'

export function QgMark({ className = 'qg-mark' }: { className?: string }) {
  return (
    <span className={className} aria-hidden='true'>
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

export function QgCheck() {
  return (
    <svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <path
        d='M5 12.5 9.5 17 19 7.5'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function QgPrimary({
  label,
  onClick,
  disabled,
  loading,
  icon,
  testId,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  icon?: ReactNode
  testId?: string
}) {
  return (
    <button
      type='button'
      className='qg-primary'
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-testid={testId}
      onClick={() => {
        if (disabled || loading) return
        hapticLight()
        onClick()
      }}
    >
      {loading ? <span className='qg-spinner-inline' aria-hidden='true' /> : icon}
      {label}
    </button>
  )
}

export function QgSecondary({
  label,
  onClick,
  disabled,
  testId,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  testId?: string
}) {
  return (
    <button
      type='button'
      className='qg-secondary'
      disabled={disabled}
      data-testid={testId}
      onClick={() => {
        if (disabled) return
        hapticLight()
        onClick()
      }}
    >
      {label}
    </button>
  )
}

export function QgTextButton({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return (
    <button
      type='button'
      className='qg-text'
      data-testid={testId}
      onClick={() => {
        hapticLight()
        onClick()
      }}
    >
      {label}
    </button>
  )
}

const DISMISS_DISTANCE = 88
const LOCK_DISTANCE = 12
const TOP_BAND = 140

export default function QgScreen({
  variant = 'flow',
  brand,
  title,
  stepLabel,
  back,
  backAriaLabel = 'Go back',
  close,
  dismiss,
  aux,
  auxAriaLabel,
  auxOnClick,
  children,
  footer,
}: {
  variant?: 'welcome' | 'flow' | 'progress' | 'success' | 'scan' | 'unlock'
  brand?: boolean
  title?: string
  stepLabel?: string
  back?: () => void
  backAriaLabel?: string
  close?: () => void
  dismiss?: () => void
  aux?: ReactNode
  auxAriaLabel?: string
  auxOnClick?: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const drag = useRef({ startY: 0, startX: 0, dy: 0, active: false, locked: false, suppressClick: false })
  const sheet = Boolean(dismiss && !back && !close)
  const activate = (fn?: () => void) => () => {
    hapticLight()
    fn?.()
  }

  useEffect(() => {
    const heading = rootRef.current?.querySelector('h1, [data-testid="screen-title"]') as HTMLElement | null
    if (!heading) return
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
    heading.focus({ preventScroll: true })
  }, [title, variant])

  useEffect(() => {
    if (!sheet) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      hapticLight()
      dismiss?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, dismiss])

  useEffect(() => {
    if (!sheet) return
    const node = rootRef.current
    if (!node) return
    const onTouchMove = (event: TouchEvent) => {
      if (drag.current.locked) event.preventDefault()
    }
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => node.removeEventListener('touchmove', onTouchMove)
  }, [sheet])

  const resetSheet = () => {
    const node = rootRef.current
    if (!node) return
    node.style.transform = ''
    node.style.transition = ''
  }

  const canStartDismiss = (event: PointerEvent<HTMLElement>) => {
    const header = headerRef.current
    const main = mainRef.current
    if (header?.contains(event.target as Node)) return true
    if ((main?.scrollTop ?? 0) > 0) return false
    const band = header ? header.getBoundingClientRect().bottom + TOP_BAND : 220
    return event.clientY <= band
  }

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!sheet || event.button !== 0) return
    if (!canStartDismiss(event)) return
    drag.current = {
      startY: event.clientY,
      startX: event.clientX,
      dy: 0,
      active: true,
      locked: false,
      suppressClick: false,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current.active) return
    const dy = event.clientY - drag.current.startY
    const dx = event.clientX - drag.current.startX
    if (!drag.current.locked) {
      if (Math.abs(dx) > LOCK_DISTANCE && Math.abs(dx) > dy) {
        drag.current.active = false
        return
      }
      if (dy < LOCK_DISTANCE) return
      drag.current.locked = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const travel = Math.max(0, dy)
    drag.current.dy = travel
    const node = rootRef.current
    if (!node) return
    node.style.transition = 'none'
    node.style.transform = `translateY(${travel}px)`
  }

  const onPointerUp = () => {
    if (!drag.current.active) return
    const dy = drag.current.dy
    const locked = drag.current.locked
    drag.current.active = false
    drag.current.suppressClick = locked
    if (locked && dy >= DISMISS_DISTANCE) {
      hapticLight()
      resetSheet()
      dismiss?.()
      return
    }
    drag.current.locked = false
    const node = rootRef.current
    if (!node) return
    node.style.transition = 'transform 180ms ease'
    node.style.transform = 'translateY(0)'
  }

  return (
    <div
      ref={rootRef}
      className={`qg-screen qg-screen-${variant}${sheet ? ' is-sheet' : ''}`}
      onPointerDown={sheet ? onPointerDown : undefined}
      onPointerMove={sheet ? onPointerMove : undefined}
      onPointerUp={sheet ? onPointerUp : undefined}
      onPointerCancel={sheet ? onPointerUp : undefined}
      onClickCapture={(event) => {
        if (!drag.current.suppressClick) return
        event.preventDefault()
        event.stopPropagation()
        drag.current.suppressClick = false
      }}
    >
      {brand ? (
        <header className='qg-brand'>
          <QgMark />
          <strong>Arkade Vault</strong>
          <small>MUTINYNET</small>
        </header>
      ) : variant === 'progress' || variant === 'success' || variant === 'unlock' ? null : (
        <header ref={headerRef} className={sheet ? 'qg-header qg-header-sheet' : 'qg-header'}>
          {sheet ? (
            <button
              type='button'
              className='qg-handle-btn'
              aria-label={backAriaLabel}
              data-testid='header-back'
              onClick={() => {
                if (drag.current.locked || drag.current.dy >= DISMISS_DISTANCE) return
                activate(dismiss)()
              }}
            >
              <span className='qg-handle' aria-hidden='true' />
            </button>
          ) : back || close ? (
            <button
              type='button'
              aria-label={close ? 'Return home' : backAriaLabel}
              data-testid={close ? 'header-close' : 'header-back'}
              onClick={activate(back || close)}
            >
              {close ? <span aria-hidden='true'>×</span> : <BackIcon />}
            </button>
          ) : (
            <span />
          )}
          {title ? <h2 data-testid='screen-title'>{title}</h2> : <span />}
          {sheet ? null : aux ? (
            <button
              type='button'
              className='qg-header-aux'
              aria-label={auxAriaLabel}
              data-testid='header-aux-btn'
              disabled={!auxOnClick}
              onClick={activate(auxOnClick)}
            >
              {aux}
            </button>
          ) : stepLabel ? (
            <small>{stepLabel}</small>
          ) : (
            <span />
          )}
        </header>
      )}
      <main
        ref={mainRef}
        className='qg-main'
        onFocus={(event) => {
          const target = event.target
          if (!(target instanceof HTMLElement)) return
          if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') return
          window.setTimeout(() => {
            target.scrollIntoView({ block: 'center', inline: 'nearest' })
          }, 50)
        }}
      >
        {children}
      </main>
      {footer ? <footer className='qg-footer'>{footer}</footer> : null}
    </div>
  )
}

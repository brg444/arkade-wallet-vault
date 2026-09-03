import { useEffect, useRef, type ReactNode } from 'react'
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

export default function QgScreen({
  variant = 'flow',
  brand,
  title,
  stepLabel,
  back,
  backAriaLabel = 'Go back',
  close,
  aux,
  auxAriaLabel,
  auxOnClick,
  children,
  footer,
}: {
  variant?: 'welcome' | 'flow' | 'progress' | 'success' | 'scan'
  brand?: boolean
  title?: string
  stepLabel?: string
  back?: () => void
  backAriaLabel?: string
  close?: () => void
  aux?: ReactNode
  auxAriaLabel?: string
  auxOnClick?: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
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

  return (
    <div ref={rootRef} className={`qg-screen qg-screen-${variant}`}>
      {brand ? (
        <header className='qg-brand'>
          <QgMark />
          <strong>Arkade Vault</strong>
          <small>MUTINYNET</small>
        </header>
      ) : variant === 'progress' || variant === 'success' ? null : (
        <header className='qg-header'>
          {back || close ? (
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
          {aux ? (
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
      <main className='qg-main'>{children}</main>
      {footer ? <footer className='qg-footer'>{footer}</footer> : null}
    </div>
  )
}

import { Landmark, Settings, Shield, Wallet, X } from 'lucide-react'
import HollowPixelMark from '../../icons/HollowPixelMark'
import { prettyNumber } from '../../lib/format'
import { hapticLight } from '../../lib/haptics'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
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

export default function VaultNavigation() {
  const { account, balancesLoaded, navigate, positions, setAccount } = useContext(VaultContext)
  const [open, setOpen] = useState(false)
  const [intro, setIntro] = useState(true)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const restoreTriggerFocus = useRef(false)

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
    hapticLight()
    restoreTriggerFocus.current = false
    setOpen(false)
  }

  const select = (screen: VaultScreen) => {
    hapticLight()
    setOpen(false)
    navigate(screen)
  }

  const chooseAccount = (next: VaultAccount) => {
    hapticLight()
    setAccount(next)
    restoreTriggerFocus.current = true
    setOpen(false)
  }

  return (
    <div className={open ? 'qg-launcher is-open' : 'qg-launcher'}>
      {open ? (
        <div className='qg-launcher-backdrop' onClick={close}>
          <nav
            className='qg-launcher-stack'
            aria-label='Main navigation'
            id='vault-main-navigation'
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
            >
              <X />
            </button>
          </nav>
        </div>
      ) : (
        <button
          ref={triggerRef}
          type='button'
          className={
            intro
              ? 'qg-launcher-trigger vault-navigation-trigger is-intro'
              : 'qg-launcher-trigger vault-navigation-trigger'
          }
          aria-label='Open navigation'
          aria-expanded='false'
          aria-controls='vault-main-navigation'
          onAnimationEnd={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.animationName.includes('qg-launcher-pulse')) setIntro(false)
          }}
          onClick={() => {
            hapticLight()
            setOpen(true)
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

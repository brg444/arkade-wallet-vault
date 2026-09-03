import SettingsIcon from '../../icons/Settings'
import VaultIcon from '../../icons/Vault'
import WalletIcon from '../../icons/Wallet'
import HollowPixelMark from '../../icons/HollowPixelMark'
import { hapticLight } from '../../lib/haptics'
import { useContext, useEffect, useRef, useState } from 'react'
import { VaultContext, type VaultScreen } from '../../vault/context'

export type VaultDestination = 'wallet' | 'security' | 'settings'

const DESTINATIONS: {
  id: VaultDestination
  label: string
  screen: VaultScreen
  testId: string
  icon: JSX.Element
}[] = [
  { id: 'wallet', label: 'Wallet', screen: 'home', testId: 'tab-wallet', icon: <WalletIcon /> },
  { id: 'security', label: 'Security', screen: 'keys', testId: 'tab-vault', icon: <VaultIcon /> },
  { id: 'settings', label: 'Settings', screen: 'settings', testId: 'tab-settings', icon: <SettingsIcon /> },
]

export function destinationForScreen(screen: VaultScreen): VaultDestination | null {
  if (screen === 'home') return 'wallet'
  if (screen === 'keys') return 'security'
  if (screen === 'settings') return 'settings'
  return null
}

export default function VaultNavigation({ active }: { active: VaultDestination }) {
  const { navigate } = useContext(VaultContext)
  const [open, setOpen] = useState(false)
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

  const select = (screen: VaultScreen) => {
    hapticLight()
    setOpen(false)
    navigate(screen)
  }

  return (
    <div className={open ? 'vault-navigation-layer is-open' : 'vault-navigation-layer'}>
      {open ? (
        <nav className='vault-navigation' aria-label='Main navigation' id='vault-main-navigation'>
          {DESTINATIONS.map((destination) => (
            <button
              key={destination.id}
              type='button'
              className={active === destination.id ? 'vault-navigation-item is-active' : 'vault-navigation-item'}
              onClick={() => select(destination.screen)}
              aria-current={active === destination.id ? 'page' : undefined}
              aria-label={destination.label}
              data-testid={destination.testId}
            >
              <span className='vault-navigation-icon' aria-hidden='true'>
                {destination.icon}
              </span>
              <span className='vault-navigation-label'>{destination.label}</span>
            </button>
          ))}
          <button
            type='button'
            className='vault-navigation-close'
            aria-label='Collapse navigation'
            onClick={() => {
              hapticLight()
              restoreTriggerFocus.current = false
              setOpen(false)
            }}
          >
            <span aria-hidden='true'>⌄</span>
          </button>
        </nav>
      ) : (
        <button
          ref={triggerRef}
          type='button'
          className='vault-navigation-trigger'
          aria-label='Open navigation'
          aria-expanded='false'
          aria-controls='vault-main-navigation'
          onClick={() => {
            hapticLight()
            setOpen(true)
          }}
        >
          <HollowPixelMark />
        </button>
      )}
    </div>
  )
}

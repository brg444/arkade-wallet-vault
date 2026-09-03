import SettingsIcon from '../../icons/Settings'
import VaultIcon from '../../icons/Vault'
import WalletIcon from '../../icons/Wallet'
import { hapticLight } from '../../lib/haptics'
import { useContext } from 'react'
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

  return (
    <div className='vault-navigation-layer'>
      <nav className='vault-navigation' aria-label='Main navigation'>
        {DESTINATIONS.map((destination) => (
          <button
            key={destination.id}
            type='button'
            className={active === destination.id ? 'vault-navigation-item is-active' : 'vault-navigation-item'}
            onClick={() => {
              hapticLight()
              navigate(destination.screen)
            }}
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
      </nav>
    </div>
  )
}

import { useContext, useEffect, useRef } from 'react'
import SettingsIcon from '../../icons/Settings'
import VaultIcon from '../../icons/Vault'
import WalletIcon from '../../icons/Wallet'
import { hapticLight } from '../../lib/haptics'
import { VaultContext, type VaultScreen } from '../../vault/context'

export type VaultTab = 'wallet' | 'vault' | 'settings'

const TABS: { id: VaultTab; label: string; screen: VaultScreen; testId: string; icon: JSX.Element }[] = [
  { id: 'wallet', label: 'Wallet', screen: 'home', testId: 'tab-wallet', icon: <WalletIcon /> },
  { id: 'vault', label: 'Security', screen: 'keys', testId: 'tab-vault', icon: <VaultIcon /> },
  { id: 'settings', label: 'Settings', screen: 'settings', testId: 'tab-settings', icon: <SettingsIcon /> },
]

export function tabForScreen(screen: VaultScreen): VaultTab | null {
  if (screen === 'home') return 'wallet'
  if (screen === 'keys') return 'vault'
  if (screen === 'settings') return 'settings'
  return null
}

export default function VaultPillNav({ visible, active }: { visible: boolean; active: VaultTab }) {
  const { navigate } = useContext(VaultContext)
  const refs = {
    wallet: useRef<HTMLDivElement>(null),
    vault: useRef<HTMLDivElement>(null),
    settings: useRef<HTMLDivElement>(null),
  }

  useEffect(() => {
    const el = refs[active].current
    if (!el) return
    el.classList.remove('pill-icon-pop')
    void el.offsetWidth
    el.classList.add('pill-icon-pop')
    const handleEnd = () => el.classList.remove('pill-icon-pop')
    el.addEventListener('animationend', handleEnd)
    return () => el.removeEventListener('animationend', handleEnd)
  }, [active])

  return (
    <div className={`pill-navbar-layer ${visible ? '' : 'pill-navbar-layer--hidden'}`}>
      <nav className='pill-navbar' aria-label='Main navigation'>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type='button'
            className={`pill-nav-btn ${active === tab.id ? 'pill-nav-btn--active' : ''}`}
            onClick={() => {
              hapticLight()
              navigate(tab.screen)
            }}
            aria-current={active === tab.id ? 'page' : undefined}
            aria-label={tab.label}
            data-testid={tab.testId}
          >
            <div ref={refs[tab.id]} className='pill-nav-icon'>
              {tab.icon}
            </div>
            <span className='pill-nav-label'>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

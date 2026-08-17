import { useContext, useEffect } from 'react'
import { VaultContext } from './providers/vault'
import './screens/Vault/vault.css'
import VaultHome from './screens/Vault/Home'
import VaultReceive from './screens/Vault/Receive'
import VaultReview from './screens/Vault/Review'
import VaultSavings from './screens/Vault/Savings'
import VaultSend from './screens/Vault/Send'
import VaultSuccess from './screens/Vault/Success'
import VaultWelcome from './screens/Vault/Welcome'
import VaultKeys from './screens/Vault/Keys'
import VaultSettings from './screens/Vault/Settings'
import VaultConditions from './screens/Vault/onboard/Conditions'
import VaultDesign from './screens/Vault/onboard/Design'
import VaultHardware from './screens/Vault/onboard/Hardware'
import VaultPasskey from './screens/Vault/onboard/Passkey'
import VaultPlan from './screens/Vault/onboard/Plan'
import VaultSignIn from './screens/Vault/onboard/SignIn'
import VaultPillNav, { tabForScreen } from './screens/Vault/PillNav'
import { bootVaultPrefs } from './lib/vault/prefs'

export default function VaultApp() {
  const { screen } = useContext(VaultContext)
  useEffect(() => {
    document.title = 'Spending vault'
    bootVaultPrefs()
  }, [])
  const tab = tabForScreen(screen)
  const showNavbar = Boolean(tab)
  const pages = {
    welcome: <VaultWelcome />,
    design: <VaultDesign />,
    hardware: <VaultHardware />,
    conditions: <VaultConditions />,
    plan: <VaultPlan />,
    passkey: <VaultPasskey />,
    home: <VaultHome />,
    receive: <VaultReceive />,
    send: <VaultSend />,
    review: <VaultReview />,
    success: <VaultSuccess />,
    savings: <VaultSavings />,
    keys: <VaultKeys />,
    settings: <VaultSettings />,
    signin: <VaultSignIn />,
  }
  const page = pages[screen] || <VaultWelcome />
  return (
    <div className={showNavbar ? 'page has-pill-navbar' : 'page'} data-testid='vault-app'>
      {page}
      {tab ? <VaultPillNav visible={showNavbar} active={tab} /> : null}
    </div>
  )
}

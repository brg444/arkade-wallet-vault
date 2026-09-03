import { useContext, useEffect } from 'react'
import { VaultContext } from './vault/context'
import './screens/Vault/vault.css'
import './screens/Vault/vault-system.css'
import VaultHome from './screens/Vault/Home'
import VaultReceive from './screens/Vault/Receive'
import VaultReview from './screens/Vault/Review'
import VaultSend from './screens/Vault/Send'
import VaultSuccess from './screens/Vault/Success'
import VaultHandoff from './screens/Vault/Handoff'
import VaultWelcome from './screens/Vault/Welcome'
import VaultKeys from './screens/Vault/Keys'
import VaultSettings from './screens/Vault/Settings'
import VaultConditions from './screens/Vault/onboard/Conditions'
import VaultDesign from './screens/Vault/onboard/Design'
import VaultHardware from './screens/Vault/onboard/Hardware'
import VaultPasskey from './screens/Vault/onboard/Passkey'
import VaultPlan from './screens/Vault/onboard/Plan'
import VaultRecovery from './screens/Vault/onboard/Recovery'
import VaultRecover from './screens/Vault/Recover'
import VaultSignIn from './screens/Vault/onboard/SignIn'
import VaultTx from './screens/Vault/Tx'
import VaultNavigation, { destinationForScreen } from './screens/Vault/Navigation'
import { bootVaultPrefs } from './lib/vault/prefs'
import { bootVaultFrame } from './lib/vault/pwaFrame'

export default function VaultApp() {
  const { screen } = useContext(VaultContext)
  useEffect(() => {
    document.title = 'Arkade Vault'
    bootVaultPrefs()
    return bootVaultFrame()
  }, [])
  const destination = destinationForScreen(screen)
  const pages = {
    welcome: <VaultWelcome />,
    handoff: <VaultHandoff />,
    design: <VaultDesign />,
    hardware: <VaultHardware />,
    recovery: <VaultRecovery />,
    recover: <VaultRecover />,
    conditions: <VaultConditions />,
    plan: <VaultPlan />,
    passkey: <VaultPasskey />,
    home: <VaultHome />,
    receive: <VaultReceive />,
    send: <VaultSend />,
    review: <VaultReview />,
    success: <VaultSuccess />,
    keys: <VaultKeys />,
    settings: <VaultSettings />,
    signin: <VaultSignIn />,
    tx: <VaultTx />,
  }
  const page = pages[screen] || <VaultWelcome />
  const className = ['page', `vault-screen-${screen}`, destination ? 'has-vault-navigation' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={className} data-testid='vault-app'>
      {page}
      {destination ? <VaultNavigation active={destination} /> : null}
    </div>
  )
}

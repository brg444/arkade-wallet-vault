import { useContext, useEffect } from 'react'
import { VaultContext } from './providers/vault'
import VaultHome from './screens/Vault/Home'
import VaultReceive from './screens/Vault/Receive'
import VaultReview from './screens/Vault/Review'
import VaultSavings from './screens/Vault/Savings'
import VaultSend from './screens/Vault/Send'
import VaultSuccess from './screens/Vault/Success'
import VaultWelcome from './screens/Vault/Welcome'
import VaultConditions from './screens/Vault/onboard/Conditions'
import VaultDesign from './screens/Vault/onboard/Design'
import VaultHardware from './screens/Vault/onboard/Hardware'
import VaultPasskey from './screens/Vault/onboard/Passkey'
import VaultPlan from './screens/Vault/onboard/Plan'
import VaultRecovery from './screens/Vault/onboard/Recovery'

export default function VaultApp() {
  const { screen } = useContext(VaultContext)
  useEffect(() => {
    document.title = 'Daily spending vault'
  }, [])
  const pages = {
    welcome: <VaultWelcome />,
    design: <VaultDesign />,
    hardware: <VaultHardware />,
    recovery: <VaultRecovery />,
    conditions: <VaultConditions />,
    plan: <VaultPlan />,
    passkey: <VaultPasskey />,
    home: <VaultHome />,
    receive: <VaultReceive />,
    send: <VaultSend />,
    review: <VaultReview />,
    success: <VaultSuccess />,
    savings: <VaultSavings />,
  }
  const page = pages[screen] || <VaultWelcome />
  return (
    <div className='page' data-testid='vault-app'>
      {page}
    </div>
  )
}

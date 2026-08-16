import { useContext } from 'react'
import { VaultContext } from './providers/vault'
import VaultHome from './screens/Vault/Home'
import VaultReceive from './screens/Vault/Receive'
import VaultReview from './screens/Vault/Review'
import VaultSavings from './screens/Vault/Savings'
import VaultSend from './screens/Vault/Send'
import VaultSuccess from './screens/Vault/Success'
import VaultWelcome from './screens/Vault/Welcome'

export default function VaultApp() {
  const { screen } = useContext(VaultContext)
  const page =
    screen === 'receive' ? (
      <VaultReceive />
    ) : screen === 'send' ? (
      <VaultSend />
    ) : screen === 'review' ? (
      <VaultReview />
    ) : screen === 'success' ? (
      <VaultSuccess />
    ) : screen === 'savings' ? (
      <VaultSavings />
    ) : screen === 'home' ? (
      <VaultHome />
    ) : (
      <VaultWelcome />
    )
  return (
    <div className='page' data-testid='vault-app'>
      {page}
    </div>
  )
}

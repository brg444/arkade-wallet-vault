import { useContext } from 'react'
import { VaultContext } from './providers/vault'
import VaultHome from './screens/Vault/Home'
import VaultInit from './screens/Vault/Init'
import VaultReceive from './screens/Vault/Receive'
import VaultRoles from './screens/Vault/Roles'
export default function VaultApp() {
  const { loaded, screen } = useContext(VaultContext)
  if (!loaded) return <div className='page' />
  if (screen === 'receive') return <VaultReceive />
  if (screen === 'roles') return <VaultRoles />
  if (screen === 'home') return <VaultHome />
  return <VaultInit />
}

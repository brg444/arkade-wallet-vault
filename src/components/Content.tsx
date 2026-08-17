import { ReactNode } from 'react'
import VaultRefresher from '../screens/Vault/Refresher'
import Refresher from './Refresher'

const vaultMode = import.meta.env.VITE_VAULT_MODE === '1'

interface ContentProps {
  children: ReactNode
  noFade?: boolean
  noRefresh?: boolean
}

export default function Content({ children, noFade, noRefresh }: ContentProps) {
  const className = noFade ? 'content no-content-fade' : 'content'
  return (
    <div className={className}>
      {vaultMode ? <VaultRefresher /> : noRefresh ? null : <Refresher />}
      <div className='content-shell'>{children}</div>
    </div>
  )
}

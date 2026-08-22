import type { ReactNode } from 'react'
import VaultRefresher from './Refresher'

interface VaultContentProps {
  children: ReactNode
  noFade?: boolean
  noRefresh?: boolean
}

/** Scroll container owned by the Vault application. */
export default function VaultContent({ children, noFade, noRefresh }: VaultContentProps) {
  return (
    <div className={noFade ? 'content no-content-fade' : 'content'}>
      {noRefresh ? null : <VaultRefresher />}
      <div className='content-shell'>{children}</div>
    </div>
  )
}

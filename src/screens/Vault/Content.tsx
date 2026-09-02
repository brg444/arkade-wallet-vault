import type { ReactNode } from 'react'
import VaultRefresher from './Refresher'

interface VaultContentProps {
  children: ReactNode
  className?: string
  noFade?: boolean
  noRefresh?: boolean
}

/** Scroll container owned by the Vault application. */
export default function VaultContent({ children, className, noFade, noRefresh }: VaultContentProps) {
  const classes = [noFade ? 'content no-content-fade' : 'content', className].filter(Boolean).join(' ')
  return (
    <div className={classes} tabIndex={0}>
      {noRefresh ? null : <VaultRefresher />}
      <div className='content-shell'>{children}</div>
    </div>
  )
}

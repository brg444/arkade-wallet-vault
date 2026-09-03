import type { ReactElement } from 'react'
import BackIcon from '../../icons/Back'
import { hapticLight } from '../../lib/haptics'

interface VaultHeaderProps {
  auxAriaLabel?: string
  auxFunc?: () => void
  auxText?: string
  auxIcon?: ReactElement
  back?: () => void
  text: string
}

/**
 * Header for the Vault application.
 *
 * Navigation is explicit. Importing the general wallet Header pulled the
 * general wallet router—and therefore every wallet screen and service—into the
 * Vault dependency graph even though the Vault has its own state machine.
 */
export default function VaultHeader({ auxAriaLabel, auxFunc, auxText, auxIcon, back, text }: VaultHeaderProps) {
  const handleBack = back
    ? () => {
        hapticLight()
        back()
      }
    : undefined

  return (
    <header className='qg-header header'>
      {handleBack ? (
        <button type='button' aria-label='Go back' data-testid='header-back' onClick={handleBack}>
          <BackIcon />
        </button>
      ) : (
        <span />
      )}
      <span className='title' data-testid='screen-title'>
        {text}
      </span>
      {auxText || auxIcon ? (
        <button
          type='button'
          className={auxText ? 'qg-header-aux has-text' : 'qg-header-aux'}
          aria-label={auxAriaLabel || auxText}
          data-testid='header-aux-btn'
          disabled={!auxFunc}
          onClick={() => {
            hapticLight()
            auxFunc?.()
          }}
        >
          {auxText || auxIcon}
        </button>
      ) : (
        <span />
      )}
    </header>
  )
}

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
    <div className='header'>
      <div className='vault-header-layout'>
        <div className='vault-header-side'>
          {handleBack ? (
            <button
              type='button'
              className='vault-header-button'
              aria-label='Go back'
              data-testid='header-back'
              onClick={handleBack}
            >
              <BackIcon />
            </button>
          ) : null}
        </div>
        <h1 className='title' data-testid='screen-title'>
          {text}
        </h1>
        <div className='vault-header-side is-end'>
          {auxText || auxIcon ? (
            <button
              type='button'
              className={auxText ? 'vault-header-button has-text' : 'vault-header-button'}
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
          ) : null}
        </div>
      </div>
    </div>
  )
}

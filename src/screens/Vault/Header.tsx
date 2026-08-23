import type { CSSProperties, ReactElement } from 'react'
import BackIcon from '../../icons/Back'
import { hapticLight } from '../../lib/haptics'
import FlexRow from '../../components/FlexRow'
import Focusable from '../../components/Focusable'
import Shadow from '../../components/Shadow'
import Text from '../../components/Text'

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

  const sideButton = (label: string) => (
    <Shadow>
      <Text color='neutral-800' centered tiny wrap>
        {label}
      </Text>
    </Shadow>
  )

  const auxStyle: CSSProperties = {
    cursor: auxFunc ? 'pointer' : 'default',
    display: 'flex',
    justifyContent: 'flex-end',
    minWidth: '4rem',
    paddingRight: '1rem',
  }

  return (
    <div className='header'>
      <FlexRow between>
        <div style={{ minWidth: '4rem', marginLeft: '0.5rem' }}>
          {handleBack ? (
            <Focusable ariaLabel='Go back' onEnter={handleBack} fit round>
              <div onClick={handleBack} style={{ cursor: 'pointer' }} aria-hidden='true'>
                <BackIcon />
              </div>
            </Focusable>
          ) : (
            '\u00A0'
          )}
        </div>
        <h1 className='title' data-testid='screen-title'>
          {text}
        </h1>
        <div style={auxStyle} onClick={auxFunc} aria-label={auxAriaLabel} data-testid='header-aux-btn'>
          {auxText || auxIcon ? (
            <Focusable ariaLabel={auxAriaLabel || auxText} onEnter={auxFunc} fit round>
              {auxText ? sideButton(auxText) : <div style={{ padding: '0.5rem' }}>{auxIcon}</div>}
            </Focusable>
          ) : (
            '\u00A0'
          )}
        </div>
      </FlexRow>
    </div>
  )
}

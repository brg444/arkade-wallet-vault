import { useContext, useEffect } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import BoltOutlineIcon from '../../icons/BoltOutline'
import SafeIcon from '../../icons/Safe'
import ShieldCheckOutlineIcon from '../../icons/ShieldCheckOutline'
import HollowPixelMark from '../../icons/HollowPixelMark'
import { isCoarsePhone } from '../../lib/vault/webauthn'
import { VaultContext } from '../../vault/context'

function Point({ icon, text }: { icon: JSX.Element; text: string }) {
  return (
    <div className='vault-welcome-point'>
      <div className='vault-welcome-point-icon'>{icon}</div>
      <Text color='neutral-800' thin wrap>
        {text}
      </Text>
    </div>
  )
}

export default function VaultWelcome() {
  const { busy, error, hasLocalEnrollment, locked, navigate, signIn } = useContext(VaultContext)
  const canSignIn = locked || !hasLocalEnrollment
  const onPhone = isCoarsePhone()

  useEffect(() => {
    if (hasLocalEnrollment && !locked) navigate('home')
  }, [hasLocalEnrollment, locked, navigate])
  return (
    <>
      <Content noRefresh className='vault-welcome-content'>
        <Padded>
          <FlexCol between>
            <div
              className='vault-welcome-stage is-ready'
              style={{
                width: '100%',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                paddingBottom: 24,
              }}
            >
              <div className='vault-welcome-brandline'>
                <div className='vault-welcome-mark' aria-hidden='true'>
                  <HollowPixelMark />
                </div>
                <span className='vault-testnet-badge'>Mutinynet</span>
              </div>
              <div className='vault-welcome-copy'>
                <div className='vault-welcome-title'>
                  <p className='vault-kicker'>Arkade Vault</p>
                  <Text heading big wrap>
                    Spending and Savings, together
                  </Text>
                </div>
                <Text color='neutral-600' small wrap>
                  Use Spending on this device, while moving Savings also requires your hardware key.
                </Text>
                <div className='vault-welcome-points'>
                  <Point
                    icon={<BoltOutlineIcon />}
                    text='Pay from Spending on this device, within the limits you reviewed'
                  />
                  <Point
                    icon={<ShieldCheckOutlineIcon />}
                    text='Approve every Savings send with both this device and your hardware key'
                  />
                  <Point icon={<SafeIcon />} text='Recover access after a waiting period if either key is lost' />
                </div>
                {!locked ? (
                  <Text color='neutral-600' tiny wrap>
                    Have your hardware public key and one-time invite ready before setup.
                  </Text>
                ) : null}
                <Text color='neutral-600' tiny wrap>
                  Mutinynet only. Don’t send real Bitcoin.
                </Text>
              </div>
            </div>
          </FlexCol>
        </Padded>
      </Content>

      <ButtonsOnBottom className='vault-welcome-actions is-ready'>
        <ErrorMessage error={Boolean(error)} text={error} />

        {locked ? (
          <Button
            onClick={() => void signIn()}
            disabled={busy}
            loading={busy}
            label={busy ? 'Unlocking…' : error ? 'Try again' : 'Unlock vault'}
          />
        ) : (
          <Button onClick={() => navigate('design')} label='Set up a new vault' />
        )}

        {canSignIn && !locked ? (
          <Button
            onClick={() => void signIn()}
            disabled={busy}
            loading={busy}
            label={
              busy
                ? onPhone
                  ? 'Waiting for device…'
                  : 'Waiting for QR…'
                : onPhone
                  ? 'Sign in to an existing vault'
                  : 'Sign in to an existing vault with QR'
            }
            secondary
          />
        ) : null}

        {locked ? <Button onClick={() => navigate('design')} label='Set up another vault' secondary /> : null}
      </ButtonsOnBottom>
    </>
  )
}

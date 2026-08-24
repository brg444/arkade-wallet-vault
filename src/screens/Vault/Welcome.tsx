import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import OnboardingLogo from '../../components/OnboardingLogo'
import Padded from '../../components/Padded'
import PixelSunrise from '../../components/PixelSunrise'
import SmallLogo from '../../components/SmallLogo'
import Text from '../../components/Text'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import BoltOutlineIcon from '../../icons/BoltOutline'
import SafeIcon from '../../icons/Safe'
import ShieldCheckOutlineIcon from '../../icons/ShieldCheckOutline'
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
  const prefersReduced = useReducedMotion()
  const [ready, setReady] = useState(prefersReduced)
  const [sunrise, setSunrise] = useState(prefersReduced)
  const logoTargetRef = useRef<HTMLDivElement>(null)

  const handleComplete = useCallback(() => setReady(true), [])

  return (
    <>
      <OnboardingLogo
        targetRef={logoTargetRef}
        onComplete={handleComplete}
        onFlyStart={() => setSunrise(true)}
        reducedMotion={prefersReduced}
      />
      <PixelSunrise show={sunrise} reducedMotion={prefersReduced} />

      <Content noRefresh>
        <Padded>
          <FlexCol between>
            <div
              className={ready ? 'vault-welcome-stage is-ready' : 'vault-welcome-stage'}
              style={{
                width: '100%',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                paddingBottom: 24,
              }}
            >
              <div
                ref={logoTargetRef}
                style={{ width: 40, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {ready ? <SmallLogo /> : null}
              </div>
              <div className='vault-welcome-copy'>
                <div className='vault-welcome-title'>
                  <p className='vault-kicker'>Arkade Vault</p>
                  <Text heading big>
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
                  This is testnet, so don’t send real bitcoin.
                </Text>
              </div>
            </div>
          </FlexCol>
        </Padded>
      </Content>

      <ButtonsOnBottom className={ready ? 'vault-welcome-actions is-ready' : 'vault-welcome-actions'}>
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

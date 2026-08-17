import { useCallback, useContext, useRef, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
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
import { VaultContext } from '../../providers/vault'

function Point({ icon, text }: { icon: JSX.Element; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.45rem 0' }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'var(--bullet-icon-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: 'var(--logo-color)',
        }}
      >
        {icon}
      </div>
      <Text color='neutral-800' thin wrap>
        {text}
      </Text>
    </div>
  )
}

export default function VaultWelcome() {
  const { busy, error, hasLocalEnrollment, navigate, signIn, status } = useContext(VaultContext)
  const canSignIn = Boolean(status?.enrolled && !hasLocalEnrollment)
  const signInReady = Boolean(status?.passkeyLoginAvailable)
  const onPhone = isCoarsePhone()
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
                <div style={{ padding: '0.9rem 0 0.7rem 4px' }}>
                  <p className='vault-kicker'>Arkade Vault</p>
                  <Text heading big>
                    Your vault
                  </Text>
                </div>
                <Text color='neutral-600' small wrap>
                  Daily spendings. Secure savings.
                </Text>
                <Point icon={<BoltOutlineIcon />} text='Daily spend with Face ID' />
                <Point icon={<ShieldCheckOutlineIcon />} text='Device + Hardware for full control.' />
                <Point icon={<SafeIcon />} text='Savings safe from device compromise' />
                <Text color='neutral-600' small wrap>
                  Testnet only. Don’t send real bitcoin.
                </Text>
              </div>
            </div>
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom className={ready ? 'vault-welcome-actions is-ready' : 'vault-welcome-actions'}>
        {canSignIn ? (
          <>
            <ErrorMessage error={Boolean(error)} text={error} />
            {signInReady ? (
              <Button
                onClick={() => void signIn()}
                disabled={busy}
                loading={busy}
                label={
                  busy
                    ? onPhone
                      ? 'Waiting for Face ID…'
                      : 'Waiting for phone QR…'
                    : onPhone
                      ? 'Sign in'
                      : 'Sign in with phone QR'
                }
              />
            ) : (
              <Text wrap>
                Sign in isn’t enabled yet. On the original device, open Settings and allow other devices. Then come
                back.
              </Text>
            )}
          </>
        ) : (
          <Button onClick={() => navigate('design')} label='Set up' />
        )}
      </ButtonsOnBottom>
    </>
  )
}

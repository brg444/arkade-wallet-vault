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
              <div style={{ padding: '0.75rem 0 0.6rem 4px' }}>
                <Text heading big>
                  A vault, not a hot wallet
                </Text>
              </div>
              <Text color='neutral-600' small wrap>
                One vault. Three keys. Daily spends use this phone. Sweeping it never does.
              </Text>
              <Point icon={<BoltOutlineIcon />} text='This phone can spend a little every day, with your passkey' />
              <Point
                icon={<ShieldCheckOutlineIcon />}
                text='Hardware plus recovery can empty or change the vault. The phone cannot'
              />
              <Point icon={<SafeIcon />} text='Savings is a separate lock. The passkey has no key to it' />
              <Text color='neutral-600' small wrap>
                Mutinynet test bitcoin only. Do not send real bitcoin. Setup takes about two minutes.
              </Text>
            </div>
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        {canSignIn ? (
          <>
            <ErrorMessage error={Boolean(error)} text={error} />
            {signInReady ? (
              <Button
                onClick={() => void signIn()}
                disabled={busy}
                loading={busy}
                label={busy ? 'Waiting for Face ID…' : 'Sign in with passkey'}
              />
            ) : (
              <Text wrap>
                Your iPhone passkey is only half of it. The first browser that created this vault still holds the locked
                phone spending key. Open this same site there, tap Keys, then Enable sign-in on other devices. After
                that, this button will ask for Face ID here.
              </Text>
            )}
          </>
        ) : (
          <Button onClick={() => navigate('design')} label='Set up this vault' />
        )}
      </ButtonsOnBottom>
    </>
  )
}

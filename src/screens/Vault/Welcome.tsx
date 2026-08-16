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
import ShieldCheckOutlineIcon from '../../icons/ShieldCheckOutline'
import SafeIcon from '../../icons/Safe'
import { VaultContext } from '../../providers/vault'

function Point({ icon, text }: { icon: JSX.Element; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0' }}>
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
  const { busy, enroll, error, lookAround } = useContext(VaultContext)
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
              <div style={{ padding: '0.75rem 0 1rem 4px' }}>
                <Text heading big>
                  Daily spending vault
                </Text>
              </div>
              <Point icon={<BoltOutlineIcon />} text='Approve payments with the passkey on this phone' />
              <Point
                icon={<ShieldCheckOutlineIcon />}
                text='A daily limit stops a stolen phone from emptying everything'
              />
              <Point icon={<SafeIcon />} text='Savings is separate and cannot be spent from this screen' />
              <Text color='neutral-600' small wrap>
                Test coins only. This is not a mainnet wallet.
              </Text>
              <ErrorMessage error={Boolean(error)} text={error} />
            </div>
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={enroll} disabled={busy} label={busy ? 'Waiting for your passkey…' : 'Set up with passkey'} />
        <Button onClick={lookAround} disabled={busy} label='Look around first' secondary />
      </ButtonsOnBottom>
    </>
  )
}

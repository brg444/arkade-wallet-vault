import { useContext } from 'react'
import Button from '../../../components/Button'
import ButtonsOnBottom from '../../../components/ButtonsOnBottom'
import Content from '../Content'
import ErrorMessage from '../../../components/Error'
import FlexCol from '../../../components/FlexCol'
import Header from '../Header'
import Padded from '../../../components/Padded'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import { isCoarsePhone } from '../../../lib/vault/webauthn'
import { VaultContext } from '../../../vault/context'
import { KeyCard } from '../ui'

export default function VaultSignIn() {
  const { busy, error, navigate, signIn, status } = useContext(VaultContext)
  const onPhone = isCoarsePhone()
  return (
    <>
      <Header text='Sign in' back={() => navigate('welcome')} />
      <Content noRefresh>
        <Padded>
          <FlexCol gap='1.15rem'>
            <Text wrap>
              {onPhone
                ? 'Use Face ID if you set this vault up here. Do not create a new passkey.'
                : 'This device will show a QR. Scan it with the device that created the vault, then Face ID there. Do not create a new passkey.'}
            </Text>
            <KeyCard
              icon={<FingerprintIcon />}
              title='This device'
              role={status?.passkeyLoginAvailable ? 'Ready to sign in' : 'Not enabled on the original device yet'}
            />
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button
          onClick={() => void signIn()}
          disabled={busy}
          loading={busy}
          label={
            busy ? (onPhone ? 'Waiting for Face ID…' : 'Waiting for QR…') : onPhone ? 'Sign in' : 'Sign in with QR'
          }
        />
      </ButtonsOnBottom>
    </>
  )
}

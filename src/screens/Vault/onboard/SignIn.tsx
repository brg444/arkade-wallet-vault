import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import { isCoarsePhone } from '../../../lib/vault/webauthn'
import { VaultContext } from '../../../providers/vault'
import { KeyCard } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultSignIn() {
  const { busy, error, navigate, signIn, status } = useContext(VaultContext)
  const onPhone = isCoarsePhone()
  return (
    <OnboardLayout
      title='Sign in'
      step={1}
      total={1}
      error={error}
      onBack={() => navigate('welcome')}
      actions={
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
      }
    >
      <Text wrap>
        {onPhone
          ? 'Use Face ID if you set this vault up here. Do not create a new passkey.'
          : 'This computer will show a QR. Scan it with the iPhone that created the vault, then Face ID there. Do not use Touch ID on this computer and do not create a new passkey.'}
      </Text>
      <KeyCard
        icon={<FingerprintIcon />}
        title='Passkey'
        role={status?.passkeyLoginAvailable ? 'Ready' : 'Not enabled on the original device yet'}
      />
      <Text color='neutral-600' tiny wrap>
        Don’t create a new passkey.
      </Text>
    </OnboardLayout>
  )
}

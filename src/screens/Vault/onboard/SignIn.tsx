import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import { VaultContext } from '../../../providers/vault'
import { KeyCard } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultSignIn() {
  const { busy, error, navigate, signIn, status } = useContext(VaultContext)
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
          label={busy ? 'Waiting for your passkey…' : 'Sign in with passkey'}
        />
      }
    >
      <Text wrap>
        This vault is already set up. Use the same passkey on this device. Do not create a new one — that would not open
        this vault.
      </Text>
      <KeyCard
        icon={<FingerprintIcon />}
        title='Existing passkey'
        role={
          status?.passkeyLoginAvailable
            ? 'Discoverable on this site. PRF must be available here.'
            : 'The original device has not enabled sign-in yet'
        }
        status={status?.passkeyLoginAvailable ? 'Ready' : 'Not enabled'}
      />
      <Text color='neutral-600' tiny wrap>
        Synced passkeys do not always carry the PRF secret. If this device cannot unlock, enable sign-in on the original
        phone first, then try a browser that supports WebAuthn PRF.
      </Text>
    </OnboardLayout>
  )
}

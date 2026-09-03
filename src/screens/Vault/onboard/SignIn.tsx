import { useContext } from 'react'
import { Fingerprint } from 'lucide-react'
import ErrorMessage from '../../../components/Error'
import { isCoarsePhone } from '../../../lib/vault/webauthn'
import { VaultContext } from '../../../vault/context'
import QgScreen, { QgPrimary } from '../qg/QgScreen'

export default function VaultSignIn() {
  const { busy, error, navigate, signIn, status } = useContext(VaultContext)
  const onPhone = isCoarsePhone()
  return (
    <QgScreen
      title='Sign in'
      back={() => navigate('welcome')}
      footer={
        <>
          <ErrorMessage error={Boolean(error)} text={error} />
          <QgPrimary
            onClick={() => void signIn()}
            disabled={busy}
            loading={busy}
            icon={<Fingerprint />}
            label={
              busy
                ? onPhone
                  ? 'Waiting for passkey…'
                  : 'Waiting for QR…'
                : error
                  ? 'Try again'
                  : onPhone
                    ? 'Sign in'
                    : 'Sign in with QR'
            }
          />
        </>
      }
    >
      <p className='qg-eyebrow'>Existing vault</p>
      <h1>Sign in with your passkey</h1>
      <p className='qg-copy'>
        {onPhone
          ? 'Use your passkey if you set this vault up here. Face ID, Touch ID, or your device PIN may approve it.'
          : 'This device will show a QR. Scan it with the device that created the vault, then approve with its passkey.'}
      </p>
      <section className='qg-device-key'>
        <Fingerprint />
        <span>
          <strong>This device</strong>
          <small>{status?.passkeyLoginAvailable ? 'Ready to sign in' : 'Not enabled on the original device yet'}</small>
        </span>
      </section>
    </QgScreen>
  )
}

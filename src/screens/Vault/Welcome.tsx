import { useContext, useEffect } from 'react'
import { Fingerprint, ShieldCheck } from 'lucide-react'
import ErrorMessage from '../../components/Error'
import { isCoarsePhone } from '../../lib/vault/webauthn'
import { VaultContext } from '../../vault/context'
import QgScreen, { QgPrimary, QgTextButton } from './qg/QgScreen'

export default function VaultWelcome() {
  const { busy, error, hasLocalEnrollment, locked, navigate, signIn } = useContext(VaultContext)
  const onPhone = isCoarsePhone()

  useEffect(() => {
    if (hasLocalEnrollment && !locked) navigate('home')
  }, [hasLocalEnrollment, locked, navigate])

  return (
    <QgScreen
      variant='welcome'
      brand
      footer={
        <>
          <ErrorMessage error={Boolean(error)} text={error} />
          {locked ? (
            <QgPrimary
              onClick={() => void signIn()}
              disabled={busy}
              loading={busy}
              label={busy ? 'Unlocking…' : error ? 'Try again' : 'Unlock vault'}
            />
          ) : (
            <QgPrimary onClick={() => navigate('design')} label='Get started' />
          )}
          {locked ? <QgTextButton onClick={() => navigate('design')} label='Set up another vault' /> : null}
          <p>
            {locked
              ? onPhone
                ? 'Use Face ID, Touch ID, or your device PIN'
                : 'Approve with the passkey on this device'
              : 'Have your hardware public key and invite ready'}
          </p>
        </>
      }
    >
      <p className='qg-eyebrow'>Money with a guardian</p>
      <h1>
        Spend freely.
        <br />
        Recover safely.
      </h1>
      <p className='qg-lead'>A wallet with enrolled limits and recovery paths you control.</p>
      <div className='qg-assurances'>
        <span>
          <Fingerprint />
          Passkey protected
        </span>
        <span>
          <ShieldCheck />
          Protected recovery
        </span>
      </div>
    </QgScreen>
  )
}

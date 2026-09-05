import { useContext, useEffect, useState } from 'react'
import { Clipboard, Fingerprint } from 'lucide-react'
import ErrorMessage from '../../../components/Error'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { isPlatformPasskeyAvailable } from '../../../lib/vault/webauthn'
import { VaultContext } from '../../../vault/context'
import QgScreen, { QgPrimary, QgTextButton } from '../qg/QgScreen'

export default function VaultPasskey() {
  const { busy, enroll, error, navigate } = useContext(VaultContext)
  const [token, setToken] = useState('')
  const [passkeyAvailable, setPasskeyAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void isPlatformPasskeyAvailable().then((available) => {
      if (active) setPasskeyAvailable(available)
    })
    return () => {
      active = false
    }
  }, [])

  const inviteReady = token.trim().length >= 32
  return (
    <QgScreen
      title='Secure this device'
      stepLabel='6 of 6'
      back={() => navigate('plan')}
      footer={
        <>
          <ErrorMessage error={Boolean(error)} text={error || ''} />
          <QgPrimary
            onClick={() => void enroll(token.trim())}
            disabled={busy || !inviteReady || passkeyAvailable !== true}
            icon={<Fingerprint />}
            label={busy ? 'Check your device…' : 'Create Vault'}
          />
          <QgTextButton onClick={() => navigate('problem')} label='Having trouble?' />
        </>
      }
    >
      <p className='qg-eyebrow'>Create access, then save your kit</p>
      <h1>Create your passkey</h1>
      <p className='qg-copy'>
        Your passkey unlocks your device’s wallet key to approve payments. Use face recognition, a fingerprint, or your
        device PIN when prompted. Biometric data stays on your device.
      </p>
      <section className='qg-device-key'>
        <Fingerprint />
        <span>
          <strong>
            {passkeyAvailable === null
              ? 'Checking passkey support…'
              : passkeyAvailable
                ? 'Device supports passkeys'
                : 'Passkey unavailable'}
          </strong>
          <small>
            {passkeyAvailable === false
              ? 'Open this invite in Safari or Chrome on a phone or computer with Face ID, Touch ID, or a device PIN.'
              : passkeyAvailable === null
                ? 'Checking this browser and device'
                : 'Vaulted will check the required unlock support when you create your passkey.'}
          </small>
        </span>
      </section>
      {passkeyAvailable === false ? <div data-testid='passkey-unavailable' className='qg-visually-hidden' /> : null}
      <label className='qg-field'>
        <span>One-time invite</span>
        <input
          value={token}
          data-testid='enrollment-token'
          aria-label='One-time invite'
          placeholder='Paste your invite'
          onChange={(event) => setToken(event.target.value)}
        />
        <small>Your invite can create one vault and is checked when you continue.</small>
      </label>
      <button
        type='button'
        className='qg-paste'
        onClick={() => void pasteFromClipboard().then((next) => setToken(next || token))}
      >
        <Clipboard />
        Paste invite
      </button>
    </QgScreen>
  )
}

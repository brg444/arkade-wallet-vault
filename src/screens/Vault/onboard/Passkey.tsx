import { useContext, useEffect, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { isPlatformPasskeyAvailable } from '../../../lib/vault/webauthn'
import { VaultContext } from '../../../vault/context'
import { KeyCard } from '../ui'
import { OnboardLayout } from './Layout'

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
    <OnboardLayout
      title='This device'
      step={6}
      error={error}
      onBack={() => navigate('plan')}
      actions={
        <>
          <Button
            onClick={() => enroll(token.trim())}
            disabled={busy || !inviteReady || passkeyAvailable !== true}
            label={busy ? 'Check your device…' : 'Secure this device'}
          />
        </>
      }
    >
      <Text wrap>
        Set this up on the phone or computer you’ll use for daily spending. Its passkey is unlocked by Face ID, Touch
        ID, or the device PIN.
      </Text>
      <KeyCard
        icon={<FingerprintIcon />}
        title='Device key'
        role='Stays on this device. It is separate from hardware and the Recovery Kit.'
      />
      {passkeyAvailable === false ? (
        <div className='vault-callout is-warning' role='status' data-testid='passkey-unavailable'>
          <Text small bold>
            This browser can’t create the device key
          </Text>
          <Text color='neutral-600' tiny wrap>
            Open this invite in Safari or Chrome on a phone or computer with Face ID, Touch ID, or a device PIN.
          </Text>
        </div>
      ) : null}
      <Input
        label='One-time invite'
        value={token}
        onChange={setToken}
        placeholder='Paste your invite'
        testId='enrollment-token'
      />
      <button
        type='button'
        className='vault-inline-paste'
        onClick={() => void pasteFromClipboard().then((next) => setToken(next || token))}
      >
        Paste invite
      </button>
      {!inviteReady ? (
        <Text color='neutral-600' tiny wrap>
          Paste the full invite from the vault service. It can only be used once.
        </Text>
      ) : null}
    </OnboardLayout>
  )
}

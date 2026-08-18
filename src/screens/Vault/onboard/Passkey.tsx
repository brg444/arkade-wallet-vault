import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import { isCoarsePhone } from '../../../lib/vault/webauthn'
import { VaultContext } from '../../../providers/vault'
import { KeyCard } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultPasskey() {
  const { busy, enterWithoutPasskey, enroll, error, liveNetwork, navigate } = useContext(VaultContext)
  const [token, setToken] = useState('')
  const onPhone = isCoarsePhone()
  return (
    <OnboardLayout
      title='Passkey'
      step={6}
      error={error}
      onBack={() => navigate('plan')}
      actions={
        <>
          <Button
            onClick={() => enroll(token.trim())}
            disabled={busy || (liveNetwork && token.trim().length < 32)}
            label={busy ? (onPhone ? 'Waiting for Face ID…' : 'Waiting for passkey…') : 'Create passkey'}
          />
          {liveNetwork ? null : <Button onClick={enterWithoutPasskey} disabled={busy} label='Skip for now' secondary />}
        </>
      }
    >
      <Text wrap>
        {onPhone
          ? 'This is this phone’s key. Face ID unlocks daily spend. If you see a QR, cancel — that’s another device.'
          : 'This is this computer’s daily spend key. Prefer Face ID on the phone that will spend.'}
      </Text>
      <KeyCard
        icon={<FingerprintIcon />}
        title={onPhone ? 'This device' : 'This computer'}
        role='Daily spend. Not hardware. Not the Recovery Kit.'
      />
      {liveNetwork ? (
        <>
          <Input
            label='Invite'
            value={token}
            onChange={setToken}
            placeholder='Paste your invite'
            testId='enrollment-token'
          />
        </>
      ) : (
        <Text color='neutral-600' tiny wrap>
          You can skip this and fund later.
        </Text>
      )}
    </OnboardLayout>
  )
}

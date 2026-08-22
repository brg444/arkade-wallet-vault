import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import { isCoarsePhone } from '../../../lib/vault/webauthn'
import { VaultContext } from '../../../vault/context'
import { KeyCard } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultPasskey() {
  const { busy, enroll, error, navigate } = useContext(VaultContext)
  const [token, setToken] = useState('')
  const onPhone = isCoarsePhone()
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
            disabled={busy || token.trim().length < 32}
            label={
              busy ? (onPhone ? 'Waiting for Face ID…' : 'Waiting…') : onPhone ? 'Use Face ID' : 'Create this device'
            }
          />
        </>
      }
    >
      <Text wrap>
        {onPhone
          ? 'This is this device’s key. Face ID unlocks daily spend. If you see a QR, cancel — that’s another device.'
          : 'This is this device’s daily spend key. Prefer Face ID on the device that will spend.'}
      </Text>
      <KeyCard icon={<FingerprintIcon />} title='This device' role='Daily spend. Not hardware. Not the Recovery Kit.' />
      <Input
        label='Invite'
        value={token}
        onChange={setToken}
        placeholder='Paste your invite'
        testId='enrollment-token'
      />
    </OnboardLayout>
  )
}

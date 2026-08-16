import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { VaultContext } from '../../../providers/vault'
import { OnboardLayout } from './Layout'

export default function VaultPasskey() {
  const { busy, enterWithoutPasskey, enroll, error, liveNetwork, navigate } = useContext(VaultContext)
  const [token, setToken] = useState('')
  return (
    <OnboardLayout
      title='Phone passkey'
      step={6}
      error={error}
      onBack={() => navigate('plan')}
      actions={
        <>
          <Button
            onClick={() => enroll(token.trim())}
            disabled={busy || (liveNetwork && token.trim().length < 32)}
            label={busy ? 'Waiting for your passkey…' : 'Create passkey'}
          />
          {liveNetwork ? null : (
            <Button onClick={enterWithoutPasskey} disabled={busy} label='Enter without a passkey' secondary />
          )}
        </>
      }
    >
      <Text wrap>
        The passkey unlocks the phone spending key on this device. It is not the hardware wallet, and it cannot spend
        savings.
      </Text>
      {liveNetwork ? (
        <>
          <Text wrap>
            This Mutinynet vault requires the one-time enrollment token from the operator. After the first successful
            registration the token is burned.
          </Text>
          <Input
            label='Enrollment token'
            value={token}
            onChange={setToken}
            placeholder='Paste the one-time token'
            testId='enrollment-token'
          />
        </>
      ) : (
        <Text wrap>
          If the vault service is offline, you can still enter with the plan you just saved. Balance will stay empty
          until you fund it.
        </Text>
      )}
      <Text color='neutral-600' tiny wrap>
        Open this page as the exact site you intend to keep using. Passkeys stick to that address.
      </Text>
    </OnboardLayout>
  )
}

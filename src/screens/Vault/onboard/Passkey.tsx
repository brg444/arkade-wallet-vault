import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import { VaultContext } from '../../../providers/vault'
import { KeyCard } from '../ui'
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
        This phone becomes the daily spending key. It cannot sweep the vault, and it cannot spend savings. Open this
        exact site whenever you want to use the passkey — it sticks to this address.
      </Text>
      <KeyCard
        icon={<FingerprintIcon />}
        title='This device'
        role='Approves ordinary payments up to today’s limit'
        status={liveNetwork ? 'Live enroll' : 'Preview ok'}
      />
      {liveNetwork ? (
        <>
          <Text wrap>
            The operator gives you a one-time invite. After the first successful passkey it is burned and cannot be
            reused.
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
          If the vault service is offline, you can still enter with the plan you just saved. Balance stays empty until
          you fund it.
        </Text>
      )}
    </OnboardLayout>
  )
}

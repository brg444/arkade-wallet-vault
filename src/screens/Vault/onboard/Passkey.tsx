import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import { VaultContext } from '../../../providers/vault'
import { OnboardLayout } from './Layout'

export default function VaultPasskey() {
  const { busy, enterWithoutPasskey, enroll, error, navigate } = useContext(VaultContext)
  return (
    <OnboardLayout
      title='Phone passkey'
      step={6}
      error={error}
      onBack={() => navigate('plan')}
      actions={
        <>
          <Button onClick={enroll} disabled={busy} label={busy ? 'Waiting for your passkey…' : 'Create passkey'} />
          <Button onClick={enterWithoutPasskey} disabled={busy} label='Enter without a passkey' secondary />
        </>
      }
    >
      <Text wrap>
        The passkey unlocks the phone spending key on this device. It is not the hardware wallet, and it cannot spend
        savings.
      </Text>
      <Text wrap>
        Use Face ID, Touch ID, or your device passkey prompt. If the vault service is offline, you can still enter with
        the plan you just saved. Balance will stay empty until you fund it.
      </Text>
      <Text color='neutral-600' tiny wrap>
        Open this page as the exact site you intend to keep using. Passkeys stick to that address.
      </Text>
    </OnboardLayout>
  )
}

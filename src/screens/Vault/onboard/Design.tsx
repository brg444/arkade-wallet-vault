import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import { VaultContext } from '../../../providers/vault'
import { OnboardLayout } from './Layout'

export default function VaultDesign() {
  const { acceptDesign, navigate } = useContext(VaultContext)
  return (
    <OnboardLayout
      title='How it is built'
      step={1}
      onBack={() => navigate('welcome')}
      actions={<Button onClick={acceptDesign} label='I understand — continue' />}
    >
      <Text wrap>
        Three independent keys. No one of them can take everything. The phone is only the daily spending key.
      </Text>
      <Text wrap>
        <strong>Phone + passkey.</strong> Approves ordinary payments up to the limits you set next. If someone steals
        the phone, they still cannot drain savings or rewrite the vault.
      </Text>
      <Text wrap>
        <strong>Hardware / external wallet.</strong> Required. Together with recovery it can sweep every coin or migrate
        the vault. The phone app never holds this private key.
      </Text>
      <Text wrap>
        <strong>Recovery key.</strong> A second offline key. After a delay it can recover funds if the phone is gone. It
        is not a cloud backup of the passkey.
      </Text>
      <Text color='neutral-600' small wrap>
        The service that cosigns daily spends cannot move savings, and cannot change these rules by itself. This hosted
        demo is a live Mutinynet vault, not a simulated balance.
      </Text>
    </OnboardLayout>
  )
}

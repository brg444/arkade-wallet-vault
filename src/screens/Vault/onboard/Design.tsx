import { useContext } from 'react'
import Button from '../../../components/Button'
import FingerprintIcon from '../../../icons/Fingerprint'
import ServerIcon from '../../../icons/Server'
import ShieldCheckOutlineIcon from '../../../icons/ShieldCheckOutline'
import Text from '../../../components/Text'
import { VaultContext } from '../../../vault/context'
import { KeyCard, Section } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultDesign() {
  const { acceptDesign, navigate } = useContext(VaultContext)
  return (
    <OnboardLayout
      title='How it works'
      step={1}
      onBack={() => navigate('welcome')}
      actions={<Button onClick={acceptDesign} label='Continue' />}
    >
      <p className='vault-onboard-eyebrow'>One Vault, two accounts</p>
      <h2 className='vault-onboard-title'>Different money needs different protection</h2>
      <Text wrap>
        Spending stays ready for everyday payments. Savings requires an additional hardware approval. Optional recovery
        can start a waiting period after a key is lost.
      </Text>
      <Section>
        <KeyCard icon={<FingerprintIcon />} title='Passkey' role='Approves every send on this device' />
        <KeyCard icon={<ShieldCheckOutlineIcon />} title='Hardware key' role='Required to move Savings' />
        <KeyCard icon={<ServerIcon />} title='Vault service' role='Approves Spending within your limits' />
      </Section>
    </OnboardLayout>
  )
}

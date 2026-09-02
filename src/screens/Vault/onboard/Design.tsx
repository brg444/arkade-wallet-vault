import { useContext } from 'react'
import Button from '../../../components/Button'
import FingerprintIcon from '../../../icons/Fingerprint'
import SafeIcon from '../../../icons/Safe'
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
      <Text wrap>
        Spending and Savings use different approval paths. Spending stays available within your limits, while every
        Savings transfer requires your hardware key.
      </Text>
      <Section>
        <KeyCard icon={<FingerprintIcon />} title='This device' role='Approves every send' />
        <KeyCard
          icon={<ShieldCheckOutlineIcon />}
          title='Hardware'
          role='Required to send from Savings or move everything without the service'
        />
        <KeyCard
          icon={<ServerIcon />}
          title='Vault service'
          role='Co-signs Spending within your limits. Can’t move Savings.'
        />
      </Section>
      <KeyCard
        icon={<SafeIcon />}
        title='Recovery'
        role='Optional: start a waiting period after losing a key, then cancel it if the request wasn’t yours.'
      />
    </OnboardLayout>
  )
}

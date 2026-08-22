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
      <Text wrap>Three keys protect this vault. Daily spend uses this device. Savings needs hardware too.</Text>
      <Section>
        <KeyCard icon={<FingerprintIcon />} title='This device' role='Daily spend with Face ID' />
        <KeyCard
          icon={<ShieldCheckOutlineIcon />}
          title='Hardware'
          role='This device + hardware moves everything, including Savings'
        />
        <KeyCard icon={<ServerIcon />} title='Vault service' role='Helps with daily spend. Can’t move Savings.' />
      </Section>
      <KeyCard
        icon={<SafeIcon />}
        title='Recovery'
        role='Optional. If you lose a key, start a waiting period. Cancel if it wasn’t you.'
      />
    </OnboardLayout>
  )
}

import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import SafeIcon from '../../../icons/Safe'
import ShieldCheckOutlineIcon from '../../../icons/ShieldCheckOutline'
import { VaultContext } from '../../../providers/vault'
import { KeyCard } from '../ui'
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
      <Text wrap>No single key can take everything. The service that helps daily spends cannot move savings.</Text>
      <KeyCard icon={<FingerprintIcon />} title='This phone' role='Daily spending, with your passkey' />
      <KeyCard icon={<ShieldCheckOutlineIcon />} title='Hardware' role='Required to sweep or change the vault' />
      <KeyCard icon={<SafeIcon />} title='Recovery' role='Opens a delayed path if this phone is gone' />
      <Text color='neutral-600' tiny wrap>
        This hosted demo is a live Mutinynet vault. Limits you see next are the ones the service already enforces.
      </Text>
    </OnboardLayout>
  )
}

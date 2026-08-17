import { useContext } from 'react'
import Button from '../../../components/Button'
import FingerprintIcon from '../../../icons/Fingerprint'
import SafeIcon from '../../../icons/Safe'
import ShieldCheckOutlineIcon from '../../../icons/ShieldCheckOutline'
import Text from '../../../components/Text'
import { VaultContext } from '../../../providers/vault'
import { KeyCard } from '../ui'
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
      <Text wrap>This phone spends a little. Hardware and recovery move everything.</Text>
      <KeyCard icon={<FingerprintIcon />} title='This phone' role='Daily spend' />
      <KeyCard icon={<ShieldCheckOutlineIcon />} title='Hardware' role='Moves everything' />
      <KeyCard icon={<SafeIcon />} title='Recovery' role='If you lose this phone' />
    </OnboardLayout>
  )
}

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
      <Text wrap>This device spends a little. With hardware, it can move everything.</Text>
      <KeyCard icon={<FingerprintIcon />} title='This device' role='Daily spend; with hardware, moves everything' />
      <KeyCard icon={<ShieldCheckOutlineIcon />} title='Hardware' role='With this device, moves everything' />
      <KeyCard icon={<SafeIcon />} title='Savings' role='No daily path. Device + hardware, or one key after a delay.' />
    </OnboardLayout>
  )
}

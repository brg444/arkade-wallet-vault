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
      <Text wrap>
        Daily spends on this device. Hardware for full control. Recovery is optional. Lose a key, start a waiting period
        you can cancel.
      </Text>
      <KeyCard icon={<FingerprintIcon />} title='This device' role='Daily spends' />
      <KeyCard icon={<ShieldCheckOutlineIcon />} title='Hardware' role='Device + hardware for full control' />
      <KeyCard
        icon={<SafeIcon />}
        title='Recovery'
        role='Optional. Starts a waiting period. Cancel if it was not you.'
      />
    </OnboardLayout>
  )
}

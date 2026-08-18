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
        Three things protect this vault. If you lose one, start recovery. That begins a waiting period. Cancel it if you
        didn’t start it.
      </Text>
      <KeyCard icon={<FingerprintIcon />} title='This device' role='Daily spend with Face ID' />
      <KeyCard
        icon={<ShieldCheckOutlineIcon />}
        title='Hardware'
        role='This device + hardware moves everything, including Savings'
      />
      <KeyCard
        icon={<SafeIcon />}
        title='Recovery'
        role='Optional. Starts a waiting period. Cancel if it wasn’t you.'
      />
      <Text color='neutral-600' tiny wrap>
        After setup you’ll get a Recovery Kit. Save it. It’s a last-resort file, not a seed, and it does not hold your
        keys.
      </Text>
    </OnboardLayout>
  )
}

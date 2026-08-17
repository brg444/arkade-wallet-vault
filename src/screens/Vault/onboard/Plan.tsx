import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import SafeIcon from '../../../icons/Safe'
import ShieldCheckOutlineIcon from '../../../icons/ShieldCheckOutline'
import { prettyAmount } from '../../../lib/format'
import { VaultContext } from '../../../providers/vault'
import { KeyCard, PolicyTimeline } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultPlan() {
  const { finishPlan, liveNetwork, navigate, setup } = useContext(VaultContext)
  return (
    <OnboardLayout
      title='Review'
      step={5}
      onBack={() => navigate('conditions')}
      actions={<Button onClick={finishPlan} label='Continue' />}
    >
      <Text wrap>This phone spends a little. Hardware and recovery move everything else.</Text>
      <KeyCard
        icon={<ShieldCheckOutlineIcon />}
        title='Hardware'
        role={setup.hardwareIsDemo ? 'Demo key' : 'Full access'}
        fingerprint={setup.hardwarePub}
      />
      <KeyCard
        icon={<SafeIcon />}
        title='Recovery'
        role={setup.recoveryIsDemo ? 'Demo key' : 'If you lose this phone'}
        fingerprint={setup.recoveryPub}
      />
      <KeyCard icon={<FingerprintIcon />} title='This phone' role={`${prettyAmount(setup.txCapSats)} per send`} />
      <PolicyTimeline
        txCap={setup.txCapSats}
        dailyLimit={setup.dailyLimitSats}
        operationalBlocks={setup.operationalCsvBlocks}
        savingsBlocks={setup.savingsCsvBlocks}
        network={liveNetwork ? 'mutinynet' : undefined}
      />
    </OnboardLayout>
  )
}

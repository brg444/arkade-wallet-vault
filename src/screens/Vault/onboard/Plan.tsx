import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
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
      step={4}
      onBack={() => navigate('conditions')}
      actions={<Button onClick={finishPlan} label='Continue' />}
    >
      <Text wrap>This device spends a little. With hardware, it can move everything.</Text>
      <KeyCard
        icon={<ShieldCheckOutlineIcon />}
        title='Hardware'
        role={setup.hardwareIsDemo ? 'Demo key' : 'With this device, moves everything'}
        fingerprint={setup.hardwarePub}
      />
      <KeyCard icon={<FingerprintIcon />} title='This device' role={`${prettyAmount(setup.txCapSats)} per send`} />
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

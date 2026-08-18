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
      <Text wrap>
        {setup.recoveryPub
          ? 'If you lose a key, start recovery and wait. Cancel if it wasn’t you. Save the Recovery Kit after setup.'
          : 'This device plus hardware. You can add recovery later on a new vault. Save the Recovery Kit after setup.'}
      </Text>
      <KeyCard
        icon={<ShieldCheckOutlineIcon />}
        title='Hardware'
        role={setup.hardwareIsDemo ? 'Demo key' : 'With this device, moves everything'}
        fingerprint={setup.hardwarePub}
      />
      {setup.recoveryPub ? (
        <KeyCard
          icon={<SafeIcon />}
          title='Recovery'
          role={setup.recoveryIsDemo ? 'Demo recovery key' : 'Starts a waiting period you can cancel'}
          fingerprint={setup.recoveryPub}
        />
      ) : (
        <KeyCard icon={<SafeIcon />} title='Recovery' role='Skipped. This device plus hardware only.' />
      )}
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

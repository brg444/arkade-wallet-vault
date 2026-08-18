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
          ? 'Lose a key, start recovery, wait. Cancel if it was not you.'
          : 'This device plus hardware. You can add recovery later on a new vault.'}
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
        <KeyCard icon={<SafeIcon />} title='Recovery' role='Skipped. Device + hardware only.' />
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

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
      title='Your vault plan'
      step={5}
      onBack={() => navigate('conditions')}
      actions={<Button onClick={finishPlan} label='Looks right — continue' />}
    >
      <Text wrap>
        {liveNetwork
          ? 'Addresses are created when you add the passkey. Check that each key and rule matches what you intend.'
          : 'Nothing is locked on-chain yet. This is the plan this phone will treat as the vault.'}
      </Text>
      <KeyCard
        icon={<ShieldCheckOutlineIcon />}
        title='Hardware'
        role={setup.hardwareIsDemo ? 'Demo key — not protection' : 'Sweep and change'}
        fingerprint={setup.hardwarePub}
        status='You hold this'
      />
      <KeyCard
        icon={<SafeIcon />}
        title='Recovery'
        role={setup.recoveryIsDemo ? 'Demo key — not protection' : 'Delayed path if the phone is gone'}
        fingerprint={setup.recoveryPub}
        status='You hold this'
      />
      <KeyCard
        icon={<FingerprintIcon />}
        title='This phone'
        role={`${prettyAmount(setup.txCapSats)} per payment`}
        status='Next'
      />
      <PolicyTimeline
        txCap={setup.txCapSats}
        dailyLimit={setup.dailyLimitSats}
        operationalBlocks={setup.operationalCsvBlocks}
        savingsBlocks={setup.savingsCsvBlocks}
        network={liveNetwork ? 'mutinynet' : undefined}
      />
      <Text color='neutral-600' small wrap>
        Next you add the phone passkey. That is only the daily spending key. It cannot replace the two keys above.
      </Text>
    </OnboardLayout>
  )
}

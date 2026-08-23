import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import SafeIcon from '../../../icons/Safe'
import ShieldCheckOutlineIcon from '../../../icons/ShieldCheckOutline'
import { prettyAmount } from '../../../lib/format'
import { PROGRAM_CSV } from '../../../lib/vault/program/constants'
import { VaultContext } from '../../../vault/context'
import { KeyCard, PolicyTimeline, Section } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultPlan() {
  const { finishPlan, liveNetwork, navigate, setup } = useContext(VaultContext)
  return (
    <OnboardLayout
      title='Your setup'
      step={5}
      onBack={() => navigate('conditions')}
      actions={<Button onClick={finishPlan} label='Secure this device' />}
    >
      <Text wrap>
        {setup.recoveryPub
          ? 'If you lose a key, start recovery and wait. Cancel if it wasn’t you. After setup, save the Recovery Kit from Security.'
          : 'This device plus hardware. You can add recovery later on a new vault.'}
      </Text>
      <Section>
        <KeyCard
          icon={<ShieldCheckOutlineIcon />}
          title='Hardware'
          role='With this device, moves everything'
          fingerprint={setup.hardwarePub}
        />
        {setup.recoveryPub ? (
          <KeyCard
            icon={<SafeIcon />}
            title='Recovery'
            role='Starts a waiting period you can cancel'
            fingerprint={setup.recoveryPub}
          />
        ) : (
          <KeyCard icon={<SafeIcon />} title='Recovery' role='Skipped. This device plus hardware only.' />
        )}
        <KeyCard icon={<FingerprintIcon />} title='This device' role={`${prettyAmount(setup.txCapSats)} per send`} />
      </Section>
      <PolicyTimeline
        txCap={setup.txCapSats}
        dailyLimit={setup.dailyLimitSats}
        phoneRecoveryBlocks={PROGRAM_CSV.phone}
        hardwareRecoveryBlocks={PROGRAM_CSV.hardware}
        network={liveNetwork ? 'mutinynet' : undefined}
      />
    </OnboardLayout>
  )
}

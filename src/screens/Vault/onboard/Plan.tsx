import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import FingerprintIcon from '../../../icons/Fingerprint'
import SafeIcon from '../../../icons/Safe'
import ShieldCheckOutlineIcon from '../../../icons/ShieldCheckOutline'
import { prettyAmount } from '../../../lib/format'
import { approximateFiatLabel } from '../../../lib/vault/fiatDisplay'
import { PROGRAM_CSV } from '../../../lib/vault/program/constants'
import { VaultContext } from '../../../vault/context'
import { KeyCard, PolicyTimeline, Section } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultPlan() {
  const { fiatDisplayRate, finishPlan, liveNetwork, navigate, setup } = useContext(VaultContext)
  const advanced = setup.protectionTier === 'advanced'
  const txFiat = approximateFiatLabel(setup.txCapSats, fiatDisplayRate)
  const allowanceFiat = approximateFiatLabel(setup.dailyLimitSats, fiatDisplayRate)
  return (
    <OnboardLayout
      title='Your setup'
      step={5}
      onBack={() => navigate('conditions')}
      actions={<Button onClick={finishPlan} label='Secure this device' />}
    >
      <Text wrap>
        <strong>{advanced ? 'Advanced protection' : 'Standard protection'}.</strong>{' '}
        {advanced
          ? 'A separate recovery key is required and can use the existing delayed recovery paths. After setup, save the Recovery Kit from Security.'
          : 'No recovery key is enrolled. Losing both this device and the hardware key can leave funds without a cooperative recovery path.'}
      </Text>
      <Section>
        <KeyCard
          icon={<ShieldCheckOutlineIcon />}
          title='Hardware'
          role='With this device, moves everything'
          fingerprint={setup.hardwarePub}
        />
        {advanced ? (
          <KeyCard
            icon={<SafeIcon />}
            title='Recovery key'
            role='Required for Advanced; starts a waiting period you can cancel'
            fingerprint={setup.recoveryPub}
          />
        ) : (
          <KeyCard icon={<SafeIcon />} title='Recovery key' role='Not enrolled with Standard.' />
        )}
        <KeyCard
          icon={<FingerprintIcon />}
          title='This device'
          role={`${prettyAmount(setup.txCapSats)} per payment${txFiat ? ` · ${txFiat}` : ''}`}
        />
      </Section>
      <PolicyTimeline
        txCap={setup.txCapSats}
        dailyLimit={setup.dailyLimitSats}
        phoneRecoveryBlocks={PROGRAM_CSV.phone}
        hardwareRecoveryBlocks={PROGRAM_CSV.hardware}
        network={liveNetwork ? 'mutinynet' : undefined}
      />
      <Text color='neutral-600' tiny wrap>
        Network: Mutinynet. Don’t send real Bitcoin. Exact limits: {prettyAmount(setup.txCapSats)} per payment
        {txFiat ? ` (${txFiat})` : ''} and {prettyAmount(setup.dailyLimitSats)} per rolling 24 hours
        {allowanceFiat ? ` (${allowanceFiat})` : ''}. Above-limit payments are refused. These spending conditions are
        bound to this vault and cannot be changed after setup.
      </Text>
    </OnboardLayout>
  )
}

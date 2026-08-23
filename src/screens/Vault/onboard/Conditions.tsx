import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import { prettyAmount } from '../../../lib/format'
import { waitLabel } from '../../../lib/vault/policy'
import { PROGRAM_CSV } from '../../../lib/vault/program/constants'
import { VaultContext } from '../../../vault/context'
import { PolicyTimeline } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultConditions() {
  const { confirmConditions, navigate, setup, status } = useContext(VaultContext)
  const txCap = status?.txCap || setup.txCapSats
  const daily = status?.periodAllowance || setup.dailyLimitSats
  const network = status?.network || 'mutinynet'

  return (
    <OnboardLayout
      title='Daily limits'
      step={4}
      onBack={() => navigate('recovery')}
      actions={<Button onClick={confirmConditions} label='Review setup' />}
    >
      <Text wrap>These limits are set by the Vault Program. This device can’t raise them.</Text>
      <PolicyTimeline
        txCap={txCap}
        dailyLimit={daily}
        phoneRecoveryBlocks={PROGRAM_CSV.phone}
        hardwareRecoveryBlocks={PROGRAM_CSV.hardware}
        network={network}
      />
      <Text color='neutral-600' tiny wrap>
        Spending allows {prettyAmount(txCap)} per send and {prettyAmount(daily)} per day. Recovery with hardware waits{' '}
        {waitLabel(PROGRAM_CSV.hardware, network)} after losing this device. Recovery from this device waits{' '}
        {waitLabel(PROGRAM_CSV.phone, network)} after losing hardware.
      </Text>
    </OnboardLayout>
  )
}

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
      actions={<Button onClick={confirmConditions} label='Continue' />}
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
        {prettyAmount(txCap)} per send · {prettyAmount(daily)} a day. Lose this device and start recovery with hardware:
        wait {waitLabel(PROGRAM_CSV.hardware, network)}. Lose hardware and start it from this device: wait{' '}
        {waitLabel(PROGRAM_CSV.phone, network)}. Cancel either one if it wasn’t you.
      </Text>
    </OnboardLayout>
  )
}

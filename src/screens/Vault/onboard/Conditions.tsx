import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import { prettyAmount } from '../../../lib/format'
import { delayLabel } from '../../../lib/vault/policy'
import { DAILY_LIMIT_CHOICES, PAYMENT_CAP_CHOICES, RECOVERY_PROFILES } from '../../../lib/vault/setup'
import { VaultContext } from '../../../providers/vault'
import { PolicyTimeline } from '../ui'
import { ChoiceCard, OnboardLayout } from './Layout'

export default function VaultConditions() {
  const { confirmConditions, liveNetwork, navigate, setCondition, setup, status } = useContext(VaultContext)
  const profile =
    RECOVERY_PROFILES.find(
      (item) =>
        item.operationalCsvBlocks === setup.operationalCsvBlocks && item.savingsCsvBlocks === setup.savingsCsvBlocks,
    ) || RECOVERY_PROFILES[0]

  if (liveNetwork) {
    const txCap = status?.txCap || setup.txCapSats
    const daily = status?.periodAllowance || setup.dailyLimitSats
    const opCsv = status?.operationalCsvBlocks || setup.operationalCsvBlocks
    const savCsv = status?.savingsCsvBlocks || setup.savingsCsvBlocks
    return (
      <OnboardLayout
        title='Spending rules'
        step={4}
        onBack={() => navigate('recovery')}
        actions={<Button onClick={confirmConditions} label='These are the live rules' />}
      >
        <Text wrap>
          These limits are already on the Mutinynet vault. This phone cannot loosen them. Hardware plus recovery can
          still sweep everything.
        </Text>
        <PolicyTimeline
          txCap={txCap}
          dailyLimit={daily}
          operationalBlocks={opCsv}
          savingsBlocks={savCsv}
          network={status?.network}
        />
        <Text color='neutral-600' tiny wrap>
          Daily path: {prettyAmount(txCap)} per payment, {prettyAmount(daily)} per day. Recovery delay{' '}
          {delayLabel(opCsv, status?.network)}.
        </Text>
      </OnboardLayout>
    )
  }

  return (
    <OnboardLayout
      title='Spending rules'
      step={4}
      onBack={() => navigate('recovery')}
      actions={<Button onClick={confirmConditions} label='Save these rules' />}
    >
      <Text wrap>These limits apply to the phone path only. Hardware plus recovery can still sweep everything.</Text>
      <Text color='neutral-600' tiny>
        Largest daily send
      </Text>
      {PAYMENT_CAP_CHOICES.map((sats) => (
        <ChoiceCard
          key={sats}
          title={prettyAmount(sats)}
          detail='Largest single send the phone can approve'
          selected={setup.txCapSats === sats}
          onClick={() => setCondition({ txCapSats: sats })}
          testId={`cap-${sats}`}
        />
      ))}
      <Text color='neutral-600' tiny>
        Each calendar day
      </Text>
      {DAILY_LIMIT_CHOICES.map((sats) => (
        <ChoiceCard
          key={sats}
          title={prettyAmount(sats)}
          detail='Total the phone can approve before tomorrow'
          selected={setup.dailyLimitSats === sats}
          onClick={() => setCondition({ dailyLimitSats: sats })}
          testId={`daily-${sats}`}
        />
      ))}
      <Text color='neutral-600' tiny>
        If the phone is gone
      </Text>
      {RECOVERY_PROFILES.filter((item) => item.id !== 'mutinynet').map((item) => (
        <ChoiceCard
          key={item.id}
          title={item.label}
          detail={item.detail}
          selected={profile.id === item.id}
          onClick={() =>
            setCondition({
              operationalCsvBlocks: item.operationalCsvBlocks,
              savingsCsvBlocks: item.savingsCsvBlocks,
            })
          }
          testId={`csv-${item.id}`}
        />
      ))}
      <Text color='neutral-600' tiny wrap>
        Preview mode only. A live Mutinynet vault uses the service policy instead of these choices.
      </Text>
    </OnboardLayout>
  )
}

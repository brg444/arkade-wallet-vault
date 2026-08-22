import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import { prettyAmount } from '../../../lib/format'
import { waitLabel } from '../../../lib/vault/policy'
import { DAILY_LIMIT_CHOICES, DELAY_PROFILES, PAYMENT_CAP_CHOICES } from '../../../lib/vault/setupPlan'
import { VaultContext } from '../../../vault/context'
import { PolicyTimeline, Section } from '../ui'
import { ChoiceCard, OnboardLayout } from './Layout'

export default function VaultConditions() {
  const { confirmConditions, liveNetwork, navigate, setCondition, setup, status } = useContext(VaultContext)
  const profile =
    DELAY_PROFILES.find(
      (item) =>
        item.operationalCsvBlocks === setup.operationalCsvBlocks && item.savingsCsvBlocks === setup.savingsCsvBlocks,
    ) || DELAY_PROFILES[0]

  if (liveNetwork) {
    const txCap = status?.txCap || setup.txCapSats
    const daily = status?.periodAllowance || setup.dailyLimitSats
    const opCsv = status?.operationalCsvBlocks || setup.operationalCsvBlocks
    const savCsv = status?.savingsCsvBlocks || setup.savingsCsvBlocks
    return (
      <OnboardLayout
        title='Daily limits'
        step={4}
        onBack={() => navigate('recovery')}
        actions={<Button onClick={confirmConditions} label='Continue' />}
      >
        <Text wrap>These limits are already set. This device can’t raise them. Hardware is for everything else.</Text>
        <PolicyTimeline
          txCap={txCap}
          dailyLimit={daily}
          operationalBlocks={opCsv}
          savingsBlocks={savCsv}
          network={status?.network}
        />
        <Text color='neutral-600' tiny wrap>
          {prettyAmount(txCap)} per send · {prettyAmount(daily)} a day. Lose this device and start recovery with
          hardware: wait {waitLabel(savCsv, status?.network)}. Lose hardware and start it from this device: wait{' '}
          {waitLabel(opCsv, status?.network)}. Cancel either one if it wasn’t you.
        </Text>
      </OnboardLayout>
    )
  }

  return (
    <OnboardLayout
      title='Daily limits'
      step={4}
      onBack={() => navigate('recovery')}
      actions={<Button onClick={confirmConditions} label='Continue' />}
    >
      <Text wrap>How much this device can send today, without hardware.</Text>
      <Section label='Per send'>
        {PAYMENT_CAP_CHOICES.map((sats) => (
          <ChoiceCard
            key={sats}
            title={prettyAmount(sats)}
            detail='This device, one payment'
            selected={setup.txCapSats === sats}
            onClick={() => setCondition({ txCapSats: sats })}
            testId={`cap-${sats}`}
          />
        ))}
      </Section>
      <Section label='Per day'>
        {DAILY_LIMIT_CHOICES.map((sats) => (
          <ChoiceCard
            key={sats}
            title={prettyAmount(sats)}
            detail='This device, today'
            selected={setup.dailyLimitSats === sats}
            onClick={() => setCondition({ dailyLimitSats: sats })}
            testId={`daily-${sats}`}
          />
        ))}
      </Section>
      <Section label='If you lose a key'>
        {DELAY_PROFILES.map((item) => (
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
      </Section>
      <Text color='neutral-600' tiny wrap>
        Preview only. A live vault uses the service limits.
      </Text>
    </OnboardLayout>
  )
}

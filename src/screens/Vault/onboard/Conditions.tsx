import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import { prettyAmount } from '../../../lib/format'
import { waitLabel } from '../../../lib/vault/policy'
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
        title='How much can this phone send?'
        step={4}
        onBack={() => navigate('recovery')}
        actions={<Button onClick={confirmConditions} label='Continue' />}
      >
        <Text wrap>These limits are already set. This phone can’t raise them.</Text>
        <PolicyTimeline
          txCap={txCap}
          dailyLimit={daily}
          operationalBlocks={opCsv}
          savingsBlocks={savCsv}
          network={status?.network}
        />
        <Text color='neutral-600' tiny wrap>
          {prettyAmount(txCap)} per send · {prettyAmount(daily)} a day · if you lose this phone,{' '}
          {waitLabel(opCsv, status?.network)}
        </Text>
      </OnboardLayout>
    )
  }

  return (
    <OnboardLayout
      title='How much can this phone send?'
      step={4}
      onBack={() => navigate('recovery')}
      actions={<Button onClick={confirmConditions} label='Save these rules' />}
    >
      <Text wrap>How much this phone can send today.</Text>
      <Text color='neutral-600' tiny>
        Per send
      </Text>
      {PAYMENT_CAP_CHOICES.map((sats) => (
        <ChoiceCard
          key={sats}
          title={prettyAmount(sats)}
          detail='Per send'
          selected={setup.txCapSats === sats}
          onClick={() => setCondition({ txCapSats: sats })}
          testId={`cap-${sats}`}
        />
      ))}
      <Text color='neutral-600' tiny>
        Per day
      </Text>
      {DAILY_LIMIT_CHOICES.map((sats) => (
        <ChoiceCard
          key={sats}
          title={prettyAmount(sats)}
          detail='Per day'
          selected={setup.dailyLimitSats === sats}
          onClick={() => setCondition({ dailyLimitSats: sats })}
          testId={`daily-${sats}`}
        />
      ))}
      <Text color='neutral-600' tiny>
        If you lose this phone
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
        Preview only. A live vault uses the service limits.
      </Text>
    </OnboardLayout>
  )
}

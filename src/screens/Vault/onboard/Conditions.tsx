import { useContext, useMemo, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { prettyAmount } from '../../../lib/format'
import { approximateFiatLabel } from '../../../lib/vault/fiatDisplay'
import { waitLabel } from '../../../lib/vault/policy'
import { PROGRAM_CSV } from '../../../lib/vault/program/constants'
import { setupSpendingPolicy } from '../../../lib/vault/setupPlan'
import { sameSpendingPolicy, spendingPolicyFromLimits } from '../../../lib/vault/spendingPolicy'
import { ABSOLUTE_FEE_CEILING_SATS, FEERATE_CEILING_SAT_PER_V } from '../../../lib/vault/constants'
import { VaultContext } from '../../../vault/context'
import { PolicyTimeline } from '../ui'
import { ChoiceCard, OnboardLayout } from './Layout'

type PolicyDraft = {
  txRecipientCapSats: string
  periodAllowanceSats: string
}

function draftFromPolicy(policy: ReturnType<typeof setupSpendingPolicy>): PolicyDraft {
  return {
    txRecipientCapSats: String(policy.txRecipientCapSats),
    periodAllowanceSats: String(policy.periodAllowanceSats),
  }
}

export default function VaultConditions() {
  const {
    confirmConditions,
    error,
    fiatDisplayEnabled,
    fiatDisplayRate,
    liveNetwork,
    navigate,
    setSpendingPolicy,
    setFiatDisplay,
    setup,
    spendingPolicyCapabilities,
  } = useContext(VaultContext)
  const setupPolicy = setupSpendingPolicy(setup)
  const initialPreset = spendingPolicyCapabilities.presets.find((preset) =>
    sameSpendingPolicy(setupPolicy, preset.policy),
  )
  const [choice, setChoice] = useState(initialPreset?.id || 'custom')
  const [draft, setDraft] = useState<PolicyDraft>(() => draftFromPolicy(setupPolicy))
  const selected = useMemo(() => {
    try {
      return spendingPolicyFromLimits({
        txRecipientCapSats: Number(draft.txRecipientCapSats),
        periodAllowanceSats: Number(draft.periodAllowanceSats),
        absoluteFeeCapSats: ABSOLUTE_FEE_CEILING_SATS,
        feerateCapSatPerV: FEERATE_CEILING_SAT_PER_V,
      })
    } catch {
      return null
    }
  }, [draft])
  const network = liveNetwork ? 'mutinynet' : undefined

  const update = (field: keyof PolicyDraft) => (value: string) => {
    setChoice('custom')
    setDraft((current) => ({ ...current, [field]: value }))
  }
  const choose = (id: string, policy: Parameters<typeof setSpendingPolicy>[0]) => {
    setChoice(id)
    setDraft(draftFromPolicy(policy))
  }
  const displayAmount = (sats: number) => {
    const fiat = approximateFiatLabel(sats, fiatDisplayRate)
    return `${prettyAmount(sats)}${fiat ? ` (${fiat})` : ''}`
  }
  const continueSetup = () => {
    if (!selected) return
    setSpendingPolicy(selected)
    confirmConditions()
  }

  return (
    <OnboardLayout
      title='Spending limits'
      step={4}
      error={error}
      onBack={() => navigate('recovery')}
      actions={<Button onClick={continueSetup} disabled={!selected} label='Review setup' />}
    >
      <Text wrap>Choose how much this vault can pay. Above-limit payments are refused.</Text>
      <button type='button' className='vault-inline-paste' onClick={() => void setFiatDisplay(!fiatDisplayEnabled)}>
        {fiatDisplayEnabled ? 'Hide approximate USD' : 'Show approximate USD'}
      </button>
      <div className='vault-policy-presets' aria-label='Spending limit presets'>
        {spendingPolicyCapabilities.presets.map((preset) => (
          <ChoiceCard
            key={preset.id}
            title={preset.label}
            detail={`${displayAmount(preset.policy.txRecipientCapSats)} per payment · ${displayAmount(preset.policy.periodAllowanceSats)} per rolling 24 hours`}
            selected={choice === preset.id}
            onClick={() => choose(preset.id, preset.policy)}
            testId={`policy-preset-${preset.id}`}
          />
        ))}
        <ChoiceCard
          title='Custom'
          detail='Set the per-payment cap and rolling 24-hour allowance.'
          selected={choice === 'custom'}
          onClick={() => setChoice('custom')}
          testId='policy-preset-custom'
        />
      </div>
      {choice === 'custom' ? (
        <div className='vault-policy-fields'>
          <Input
            type='number'
            label='Maximum per payment (sats)'
            value={draft.txRecipientCapSats}
            min={String(spendingPolicyCapabilities.bounds.txRecipientCapSats.min)}
            max={String(spendingPolicyCapabilities.bounds.txRecipientCapSats.max)}
            onChange={update('txRecipientCapSats')}
            testId='policy-tx-cap'
          />
          <Input
            type='number'
            label='Rolling 24-hour allowance (sats)'
            value={draft.periodAllowanceSats}
            min={String(spendingPolicyCapabilities.bounds.periodAllowanceSats.min)}
            max={String(spendingPolicyCapabilities.bounds.periodAllowanceSats.max)}
            onChange={update('periodAllowanceSats')}
            testId='policy-period-allowance'
          />
        </div>
      ) : null}
      {selected ? (
        <PolicyTimeline
          txCap={selected.txRecipientCapSats}
          dailyLimit={selected.periodAllowanceSats}
          phoneRecoveryBlocks={PROGRAM_CSV.phone}
          hardwareRecoveryBlocks={PROGRAM_CSV.hardware}
          network={network}
        />
      ) : (
        <div className='vault-callout is-warning' role='status'>
          <Text small bold>
            Check these limits
          </Text>
          <Text color='neutral-600' tiny wrap>
            The rolling allowance must cover at least one maximum-size payment, and both values must stay within the
            supported range.
          </Text>
        </div>
      )}
      <Text color='neutral-600' tiny wrap>
        Hardware recovery waits {waitLabel(PROGRAM_CSV.hardware, network)} after losing this device. Recovery from this
        device waits {waitLabel(PROGRAM_CSV.phone, network)} after losing hardware.
      </Text>
    </OnboardLayout>
  )
}

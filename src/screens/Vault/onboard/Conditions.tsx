import { useContext, useMemo, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { prettyAmount } from '../../../lib/format'
import { waitLabel } from '../../../lib/vault/policy'
import { PROGRAM_CSV } from '../../../lib/vault/program/constants'
import { setupSpendingPolicy } from '../../../lib/vault/setupPlan'
import { sameSpendingPolicy, spendingPolicyFromLimits } from '../../../lib/vault/spendingPolicy'
import { VaultContext } from '../../../vault/context'
import { PolicyTimeline } from '../ui'
import { ChoiceCard, OnboardLayout } from './Layout'

type PolicyDraft = {
  txRecipientCapSats: string
  periodAllowanceSats: string
  absoluteFeeCapSats: string
  feerateCapSatPerV: string
}

function draftFromPolicy(policy: ReturnType<typeof setupSpendingPolicy>): PolicyDraft {
  return {
    txRecipientCapSats: String(policy.txRecipientCapSats),
    periodAllowanceSats: String(policy.periodAllowanceSats),
    absoluteFeeCapSats: String(policy.absoluteFeeCapSats),
    feerateCapSatPerV: String(policy.feerateCapSatPerV),
  }
}

export default function VaultConditions() {
  const { confirmConditions, error, liveNetwork, navigate, setSpendingPolicy, setup, spendingPolicyCapabilities } =
    useContext(VaultContext)
  const [draft, setDraft] = useState<PolicyDraft>(() => draftFromPolicy(setupSpendingPolicy(setup)))
  const selected = useMemo(() => {
    try {
      return spendingPolicyFromLimits({
        txRecipientCapSats: Number(draft.txRecipientCapSats),
        periodAllowanceSats: Number(draft.periodAllowanceSats),
        absoluteFeeCapSats: Number(draft.absoluteFeeCapSats),
        feerateCapSatPerV: Number(draft.feerateCapSatPerV),
      })
    } catch {
      return null
    }
  }, [draft])
  const network = liveNetwork ? 'mutinynet' : undefined

  const update = (field: keyof PolicyDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }))
  const choose = (policy: Parameters<typeof setSpendingPolicy>[0]) => setDraft(draftFromPolicy(policy))
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
      <Text wrap>Choose the limits this vault will enforce. They become permanent when you secure this device.</Text>
      <div className='vault-policy-presets' aria-label='Spending limit presets'>
        {spendingPolicyCapabilities.presets.map((preset) => (
          <ChoiceCard
            key={preset.id}
            title={preset.label}
            detail={`${prettyAmount(preset.policy.txRecipientCapSats)} per send · ${prettyAmount(preset.policy.periodAllowanceSats)} per rolling 24 hours`}
            selected={Boolean(selected && sameSpendingPolicy(selected, preset.policy))}
            onClick={() => choose(preset.policy)}
            testId={`policy-preset-${preset.id}`}
          />
        ))}
      </div>
      <div className='vault-policy-fields'>
        <Input
          type='number'
          label='Maximum per send (sats)'
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
        <Input
          type='number'
          label='Maximum fee (sats)'
          value={draft.absoluteFeeCapSats}
          min={String(spendingPolicyCapabilities.bounds.absoluteFeeCapSats.min)}
          max={String(spendingPolicyCapabilities.bounds.absoluteFeeCapSats.max)}
          onChange={update('absoluteFeeCapSats')}
          testId='policy-fee-cap'
        />
        <Input
          type='number'
          label='Maximum fee rate (sat/vB)'
          value={draft.feerateCapSatPerV}
          min={String(spendingPolicyCapabilities.bounds.feerateCapSatPerV.min)}
          max={String(spendingPolicyCapabilities.bounds.feerateCapSatPerV.max)}
          onChange={update('feerateCapSatPerV')}
          testId='policy-feerate-cap'
        />
      </div>
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
            The rolling allowance must cover at least one maximum-size send, and every value must stay within the
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

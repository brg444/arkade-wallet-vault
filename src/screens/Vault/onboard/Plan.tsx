import { useContext } from 'react'
import Button from '../../../components/Button'
import Text from '../../../components/Text'
import { prettyAmount } from '../../../lib/format'
import { shortKey } from '../../../lib/vault/setup'
import { VaultContext } from '../../../providers/vault'
import { OnboardLayout } from './Layout'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text color='neutral-600' tiny>
        {label}
      </Text>
      <Text small wrap>
        {value}
      </Text>
    </div>
  )
}

export default function VaultPlan() {
  const { finishPlan, navigate, setup } = useContext(VaultContext)
  return (
    <OnboardLayout
      title='Your vault plan'
      step={5}
      onBack={() => navigate('conditions')}
      actions={<Button onClick={finishPlan} label='Looks right — continue' />}
    >
      <Text wrap>Nothing is locked on-chain yet. This is the plan this phone will treat as the vault.</Text>
      <Row
        label='Hardware / external'
        value={`${shortKey(setup.hardwarePub)}${setup.hardwareIsDemo ? ' · demo key' : ''}`}
      />
      <Row label='Recovery' value={`${shortKey(setup.recoveryPub)}${setup.recoveryIsDemo ? ' · demo key' : ''}`} />
      <Row label='Phone may send' value={`${prettyAmount(setup.txCapSats)} per payment`} />
      <Row label='Phone may send today' value={prettyAmount(setup.dailyLimitSats)} />
      <Row
        label='Recovery delay'
        value={`${setup.operationalCsvBlocks} blocks for spending · ${setup.savingsCsvBlocks} for savings`}
      />
      <Text color='neutral-600' small wrap>
        Next you add the phone passkey. That is only the daily spending key. It cannot replace the two keys above.
      </Text>
    </OnboardLayout>
  )
}

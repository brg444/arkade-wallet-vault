import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import FlexRow from '../../components/FlexRow'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import { prettyAmount } from '../../lib/format'
import { fingerprint } from '../../lib/vault/hex'
import { VaultContext } from '../../providers/vault'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <FlexCol gap='0.15rem'>
      <Text color='neutral-600' tiny>
        {label}
      </Text>
      <Text small wrap>
        {value}
      </Text>
    </FlexCol>
  )
}

export default function VaultHome() {
  const { descriptor, descriptorHash, navigate, reset, status } = useContext(VaultContext)
  const remaining = status?.periodRemaining
  const spent = status?.periodSpent
  const allowance = descriptor?.policy.periodAllowanceSats ?? status?.periodAllowance

  return (
    <>
      <Header text='Operational vault' auxText='Reset' auxFunc={reset} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text bigger bold>
              {remaining === undefined ? 'Watch-only' : prettyAmount(remaining)}
            </Text>
            <Text color='neutral-600' small>
              {allowance === undefined
                ? 'Import status to see remaining daily allowance'
                : `${prettyAmount(spent ?? 0)} spent of ${prettyAmount(allowance)} today`}
            </Text>
            <Row label='Operational' value={descriptor?.operational.address || status?.operationalAddress || '—'} />
            <Row label='Savings' value={descriptor?.savings.address || status?.savingsAddress || '—'} />
            <Row
              label='Savings excludes routine cosigners'
              value={
                descriptor?.savings.excludesRoutineCosigners || status?.savingsExcludesRoutineCosigners
                  ? 'yes'
                  : 'unknown'
              }
            />
            <Row label='Network' value={descriptor?.network || status?.network || '—'} />
            <Row label='Descriptor hash' value={descriptorHash ? fingerprint(descriptorHash, 6) : 'import full descriptor'} />
            <Row
              label='PhoneRoutine'
              value={fingerprint(descriptor?.keys.phoneRoutineBip340 || status?.phoneRoutineBip340Pub || '')}
            />
            <Text color='neutral-600' tiny wrap>
              Routine send is not in this slice. Receive shows the Operational address only.
            </Text>
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <FlexRow>
          <Button onClick={() => navigate('receive')} label='Receive' />
          <Button onClick={() => navigate('roles')} label='Roles' secondary />
        </FlexRow>
      </ButtonsOnBottom>
    </>
  )
}

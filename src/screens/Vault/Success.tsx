import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import Success from '../../components/Success'
import { prettyAmount } from '../../lib/format'
import { vaultTransactionExplorer } from '../../lib/vault/explorer'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../vault/context'
import { Detail } from './ui'

export default function VaultSuccess() {
  const { boardingAddress, lastSend, lastTxid, lastTxKind, navigate, status } = useContext(VaultContext)
  const amount = lastSend ? prettyAmount(lastSend.amount) : 'Sent'
  const movingToSpending = Boolean(lastSend && boardingAddress && lastSend.address === boardingAddress)
  const lightning = lastTxKind === 'lightning'
  const explorer = lastTxKind
    ? vaultTransactionExplorer(lastTxid, lastTxKind === 'onchain' ? 'onchain' : 'arkade', status?.network)
    : null

  return (
    <>
      <Header
        text={lastTxKind === 'onchain' ? 'Savings transfer submitted' : lightning ? 'Payment started' : 'Payment sent'}
      />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Success
              headline={amount}
              text={
                movingToSpending
                  ? 'Bitcoin confirmation is next'
                  : lightning
                    ? 'Quote accepted. The Lightning payment is completing.'
                    : lastTxKind === 'vtxo'
                      ? 'Arkade transfer'
                      : lastTxKind === 'onchain'
                        ? 'Bitcoin confirmation is next'
                        : 'Done'
              }
            />
            {lastSend ? (
              <>
                <Detail
                  label='To'
                  value={movingToSpending ? 'Spending' : lightning ? 'Lightning' : truncateAddress(lastSend.address, 8)}
                  mono={!movingToSpending && !lightning}
                />
                <Detail label='Fee' value={prettyAmount(lastSend.fee)} />
                <Detail label='Network' value={status?.network === 'mutinynet' ? 'Mutinynet' : 'Test network'} />
                {lastTxid ? (
                  <Detail label={lastTxKind === 'vtxo' ? 'VTXO identifier' : 'Transaction ID'} value={lastTxid} mono />
                ) : null}
              </>
            ) : null}
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={() => navigate('home')} label='Done' />
        {explorer ? (
          <Button
            onClick={() => window.open(explorer.url, '_blank', 'noopener,noreferrer')}
            label={explorer.label}
            secondary
          />
        ) : null}
      </ButtonsOnBottom>
    </>
  )
}

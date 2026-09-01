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
      <Header text={movingToSpending ? 'Moving' : lightning ? 'Payment started' : 'Sent'} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Success
              headline={amount}
              text={
                movingToSpending
                  ? 'Finishes after Bitcoin confirms'
                  : lightning
                    ? 'The Lightning payment is on the way'
                    : lastTxKind === 'vtxo'
                      ? 'Sent as a VTXO'
                      : lastTxid
                        ? 'Broadcast on testnet'
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

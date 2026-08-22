import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import Success from '../../components/Success'
import { prettyAmount } from '../../lib/format'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../vault/context'
import { Detail } from './ui'

export default function VaultSuccess() {
  const { boardingAddress, lastSend, lastTxid, lastTxKind, liveNetwork, navigate } = useContext(VaultContext)
  const amount = lastSend ? prettyAmount(lastSend.amount) : 'Sent'
  const movingToSpending = Boolean(lastSend && boardingAddress && lastSend.address === boardingAddress)
  const explorer = lastTxid && lastTxKind === 'onchain' ? `https://mempool.mutinynet.arkade.sh/tx/${lastTxid}` : ''

  return (
    <>
      <Header text={movingToSpending ? 'Moving' : 'Sent'} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Success
              headline={amount}
              text={
                movingToSpending
                  ? 'Finishes after Bitcoin confirms'
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
                  value={movingToSpending ? 'Spending' : truncateAddress(lastSend.address, 8)}
                  mono={!movingToSpending}
                />
                <Detail label='Fee' value={prettyAmount(lastSend.fee)} />
              </>
            ) : null}
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={() => navigate('home')} label='Done' />
        {liveNetwork && explorer ? (
          <Button onClick={() => window.open(explorer, '_blank')} label='View on explorer' secondary />
        ) : null}
      </ButtonsOnBottom>
    </>
  )
}

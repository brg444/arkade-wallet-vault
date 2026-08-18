import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Success from '../../components/Success'
import { prettyAmount } from '../../lib/format'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../providers/vault'
import { Detail } from './ui'

export default function VaultSuccess() {
  const { lastSend, lastTxid, liveNetwork, navigate } = useContext(VaultContext)
  const amount = lastSend ? prettyAmount(lastSend.amount) : 'Sent'
  const explorer = lastTxid ? `https://mempool.mutinynet.arkade.sh/tx/${lastTxid}` : ''

  return (
    <>
      <Header text='Sent' />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Success headline={amount} text={lastTxid ? 'On testnet' : 'Done'} />
            {lastSend ? (
              <>
                <Detail label='To' value={truncateAddress(lastSend.address, 8)} mono />
                <Detail label='Fee' value={prettyAmount(lastSend.fee)} />
              </>
            ) : null}
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        {liveNetwork && explorer ? (
          <Button onClick={() => window.open(explorer, '_blank')} label='View' secondary />
        ) : null}
        <Button onClick={() => navigate('home')} label='Done' />
      </ButtonsOnBottom>
    </>
  )
}

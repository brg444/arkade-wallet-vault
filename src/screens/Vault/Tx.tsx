import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import { prettyAmount, prettyDate } from '../../lib/format'
import { VaultContext } from '../../providers/vault'
import { Detail } from './ui'

export default function VaultTx() {
  const { liveNetwork, navigate, selectedTx } = useContext(VaultContext)
  const sent = selectedTx?.type === 'sent'
  const explorer = selectedTx ? `https://mempool.mutinynet.arkade.sh/tx/${selectedTx.txid}` : ''

  return (
    <>
      <Header text={sent ? 'Sent' : 'Received'} back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol gap='1.15rem'>
            <div className='vault-hero'>
              <p className='vault-kicker'>{sent ? 'You sent' : 'You received'}</p>
              <p className='vault-money'>{selectedTx ? prettyAmount(selectedTx.amount) : '—'}</p>
            </div>
            <Detail
              label='When'
              value={selectedTx?.confirmed && selectedTx.blockTime ? prettyDate(selectedTx.blockTime) : 'Unconfirmed'}
            />
            <Detail label='Account' value={selectedTx?.account === 'savings' ? 'Savings' : 'Spending'} />
            {selectedTx ? <Detail label='Transaction' value={selectedTx.txid} mono /> : null}
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

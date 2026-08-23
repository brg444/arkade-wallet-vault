import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import { prettyAmount, prettyDate } from '../../lib/format'
import { vaultTransactionExplorer } from '../../lib/vault/explorer'
import { VaultContext } from '../../vault/context'
import { Detail } from './ui'

export default function VaultTx() {
  const { navigate, selectedTx, status: vaultStatus } = useContext(VaultContext)
  const sent = selectedTx?.type === 'sent'
  const explorer = selectedTx
    ? vaultTransactionExplorer(
        selectedTx.txid,
        selectedTx.account === 'spend' ? 'arkade' : 'onchain',
        vaultStatus?.network,
      )
    : null
  const status = selectedTx
    ? selectedTx.account === 'spend'
      ? selectedTx.confirmed
        ? 'Settled'
        : 'Preconfirmed'
      : selectedTx.confirmed
        ? 'Confirmed'
        : 'Pending confirmation'
    : 'Unknown'

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
            <Detail label='Status' value={status} />
            <Detail
              label='When'
              value={selectedTx?.blockTime ? prettyDate(selectedTx.blockTime) : 'Not available yet'}
            />
            <Detail label='Account' value={selectedTx?.account === 'savings' ? 'Savings' : 'Spending'} />
            {selectedTx ? <Detail label='Transaction' value={selectedTx.txid} mono /> : null}
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

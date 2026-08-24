import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import { prettyAmount, prettyDate } from '../../lib/format'
import { vaultTransactionExplorer } from '../../lib/vault/explorer'
import { VaultContext } from '../../vault/context'
import { Detail } from './ui'

export default function VaultTx() {
  const { busy, error, navigate, retryLightningRefund, selectedTx, status: vaultStatus } = useContext(VaultContext)
  const sent = selectedTx?.type === 'sent'
  const boarding = selectedTx?.activity === 'boarding'
  const lightning = selectedTx?.activity === 'lightning'
  const explorer = selectedTx
    ? vaultTransactionExplorer(
        selectedTx.txid,
        boarding || selectedTx.account === 'savings' ? 'onchain' : 'arkade',
        vaultStatus?.network,
      )
    : null
  const status = selectedTx
    ? boarding
      ? 'Pending'
      : lightning
        ? ['claimed', 'settled'].includes(selectedTx.lightningState || '')
          ? 'Paid'
          : selectedTx.lightningState === 'refunded'
            ? 'Refunded'
            : selectedTx.lightningState === 'needs_counterparty'
              ? 'Ready to return'
              : 'Processing'
        : selectedTx.confirmed
          ? 'Confirmed'
          : 'Pending'
    : 'Unknown'

  return (
    <>
      <Header text={lightning ? 'Lightning payment' : sent ? 'Sent' : 'Received'} back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol gap='1.15rem'>
            <div className='vault-hero'>
              <p className='vault-kicker'>{lightning ? 'You paid' : sent ? 'You sent' : 'You received'}</p>
              <p className='vault-money'>
                {selectedTx ? prettyAmount(selectedTx.displayAmount ?? selectedTx.amount) : '—'}
              </p>
            </div>
            <Detail label='Status' value={status} />
            <Detail
              label='When'
              value={selectedTx?.blockTime ? prettyDate(selectedTx.blockTime) : 'Not available yet'}
            />
            <Detail label='Account' value={selectedTx?.account === 'savings' ? 'Savings' : 'Spending'} />
            {lightning && selectedTx?.fee !== undefined ? (
              <Detail label='Fee' value={prettyAmount(selectedTx.fee)} />
            ) : null}
            {selectedTx ? <Detail label='Transaction' value={selectedTx.txid} mono /> : null}
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        {selectedTx?.lightningState === 'needs_counterparty' && selectedTx.lightningRfqId ? (
          <Button
            onClick={() => retryLightningRefund(selectedTx.lightningRfqId!)}
            label='Return to Spending'
            disabled={busy}
            loading={busy}
          />
        ) : null}
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

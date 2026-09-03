import { useContext } from 'react'
import { Clock3 } from 'lucide-react'
import ErrorMessage from '../../components/Error'
import { prettyAmount, prettyDate, prettyNumber } from '../../lib/format'
import { vaultTransactionExplorer } from '../../lib/vault/explorer'
import { VaultContext } from '../../vault/context'
import QgScreen, { QgPrimary, QgSecondary } from './qg/QgScreen'

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
    ? lightning
      ? ['claimed', 'settled'].includes(selectedTx.lightningState || '')
        ? 'Paid'
        : selectedTx.lightningState === 'refunded'
          ? 'Refunded'
          : selectedTx.lightningState === 'needs_counterparty'
            ? 'Ready to return'
            : selectedTx.lightningState === 'failed'
              ? 'Needs recovery'
              : 'Processing'
      : selectedTx.confirmed
        ? 'Confirmed'
        : 'Pending'
    : 'Unknown'
  const amount = selectedTx?.displayAmount ?? selectedTx?.amount ?? 0

  return (
    <QgScreen
      title={lightning ? 'Lightning payment' : 'Transaction'}
      dismiss={() => navigate('home')}
      footer={
        <>
          <ErrorMessage error={Boolean(error)} text={error} />
          {selectedTx?.lightningState === 'needs_counterparty' && selectedTx.lightningRfqId ? (
            <QgPrimary
              onClick={() => retryLightningRefund(selectedTx.lightningRfqId!)}
              disabled={busy}
              loading={busy}
              label='Return to Spending'
            />
          ) : null}
          <QgPrimary onClick={() => navigate('home')} label='Back to Wallet' />
          {explorer ? (
            <QgSecondary
              onClick={() => window.open(explorer.url, '_blank', 'noopener,noreferrer')}
              label={explorer.label}
            />
          ) : null}
        </>
      }
    >
      <div className='qg-pending-label'>
        <Clock3 />
        <span>
          <strong>{status}</strong>
          <small>
            {selectedTx?.account === 'savings' ? 'From Savings' : lightning ? 'Lightning' : sent ? 'Sent' : 'Received'}
          </small>
        </span>
      </div>
      <h1>
        {sent ? '−' : '+'}
        {prettyNumber(amount, 0)} <small>SATS</small>
      </h1>
      <section className='qg-details'>
        <div>
          <span>{sent ? 'Sent' : 'Received'}</span>
          <strong>{prettyAmount(amount)}</strong>
        </div>
        {lightning && selectedTx?.fee !== undefined ? (
          <div>
            <span>Fee</span>
            <strong>{prettyAmount(selectedTx.fee)}</strong>
          </div>
        ) : null}
        <div>
          <span>Status</span>
          <strong>{status}</strong>
        </div>
        <div>
          <span>When</span>
          <strong>{selectedTx?.blockTime ? prettyDate(selectedTx.blockTime) : 'Not available yet'}</strong>
        </div>
        <div>
          <span>Account</span>
          <strong>{selectedTx?.account === 'savings' ? 'Savings' : 'Spending'}</strong>
        </div>
        <div>
          <span>Network</span>
          <strong>{vaultStatus?.network === 'mutinynet' ? 'Mutinynet' : 'Test network'}</strong>
        </div>
      </section>
      <p className='qg-copy'>
        {selectedTx?.confirmed
          ? 'This payment is confirmed.'
          : 'This will update automatically after Bitcoin confirmation.'}
      </p>
    </QgScreen>
  )
}

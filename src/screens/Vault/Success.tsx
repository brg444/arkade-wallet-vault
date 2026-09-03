import { useContext } from 'react'
import { prettyAmount } from '../../lib/format'
import { vaultTransactionExplorer } from '../../lib/vault/explorer'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../vault/context'
import QgScreen, { QgCheck, QgPrimary, QgSecondary } from './qg/QgScreen'

export default function VaultSuccess() {
  const { boardingAddress, lastSend, lastTxid, lastTxKind, navigate, status } = useContext(VaultContext)
  const movingToSpending = Boolean(lastSend && boardingAddress && lastSend.address === boardingAddress)
  const lightning = lastTxKind === 'lightning'
  const onchain = lastTxKind === 'onchain'
  const explorer = lastTxKind
    ? vaultTransactionExplorer(lastTxid, lastTxKind === 'onchain' ? 'onchain' : 'arkade', status?.network)
    : null

  const headline = onchain ? 'Savings transfer submitted' : lightning ? 'Payment started' : 'Payment sent'
  const copy = movingToSpending
    ? 'Bitcoin confirmation is next'
    : lightning
      ? 'Quote accepted. The Lightning payment is completing.'
      : lastTxKind === 'vtxo'
        ? 'Fast transfer complete'
        : onchain
          ? 'Bitcoin confirmation is next'
          : 'Done'

  return (
    <QgScreen
      variant='success'
      footer={
        <>
          <QgPrimary onClick={() => navigate('home')} label='Done' />
          {explorer ? (
            <QgSecondary
              onClick={() => window.open(explorer.url, '_blank', 'noopener,noreferrer')}
              label={explorer.label}
            />
          ) : lastTxid ? (
            <QgSecondary onClick={() => navigate('tx')} label='View transaction' />
          ) : null}
        </>
      }
    >
      <div className='qg-centered qg-success-screen'>
        <div className='qg-success-label'>
          <span>
            <QgCheck />
          </span>
          <p>{onchain ? 'Submitted' : lightning ? 'Started' : 'Sent'}</p>
        </div>
        <h1>{headline}</h1>
        <p className='qg-copy'>{copy}</p>
        {lastSend ? (
          <section className='qg-details'>
            <div>
              <span>Amount</span>
              <strong>{prettyAmount(lastSend.amount)}</strong>
            </div>
            <div>
              <span>To</span>
              <strong>
                {movingToSpending ? 'Spending' : lightning ? 'Lightning' : truncateAddress(lastSend.address, 8)}
              </strong>
            </div>
            {lastTxid ? (
              <div>
                <span>{lastTxKind === 'vtxo' ? 'VTXO identifier' : 'Transaction ID'}</span>
                <strong>{truncateAddress(lastTxid, 8)}</strong>
              </div>
            ) : null}
            <div>
              <span>Network</span>
              <strong>{status?.network === 'mainnet' ? 'Bitcoin' : 'Mutinynet'}</strong>
            </div>
          </section>
        ) : null}
      </div>
    </QgScreen>
  )
}

import { useContext } from 'react'
import Text from '../../components/Text'
import ReceivedIcon from '../../icons/Received'
import SentIcon from '../../icons/Sent'
import { prettyAmount } from '../../lib/format'
import { hapticSubtle } from '../../lib/haptics'
import { groupVaultHistory } from '../../lib/vault/history'
import { VaultContext } from '../../vault/context'

function historyTime(blockTime?: number): string {
  if (!blockTime) return ''
  return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(blockTime * 1000))
}

export default function VaultHistory() {
  const { account, balanceError, balancesLoaded, history, openTx, refreshingBalance } = useContext(VaultContext)
  const accountName = account === 'savings' ? 'Savings' : 'Spending'

  if (!balancesLoaded || history.length === 0) {
    return (
      <section
        className='vault-history'
        data-testid='vault-history'
        aria-busy={!balancesLoaded}
        aria-labelledby='vault-activity-title'
      >
        <div className='vault-history-head'>
          <h2 id='vault-activity-title'>Activity</h2>
          <span>{refreshingBalance ? `Refreshing ${accountName}` : accountName}</span>
        </div>
        <div className='vault-history-empty' role={!balancesLoaded ? 'status' : undefined}>
          <Text color='neutral-600' tiny wrap>
            {!balancesLoaded
              ? balanceError
                ? 'Activity is unavailable. Refresh to try again.'
                : 'Loading activity…'
              : account === 'savings'
                ? 'No Savings activity yet. Add bitcoin to your Savings address to see it here.'
                : 'No Spending activity yet. Receive a payment to see it here.'}
          </Text>
        </div>
      </section>
    )
  }

  return (
    <section className='vault-history' data-testid='vault-history' aria-labelledby='vault-activity-title'>
      <div className='vault-history-head'>
        <h2 id='vault-activity-title'>Activity</h2>
        <span>{refreshingBalance ? `Refreshing ${accountName}` : accountName}</span>
      </div>
      {groupVaultHistory(history).map((group) => (
        <div className='vault-history-group' key={group.key}>
          <h3 className='vault-history-group-label'>{group.label}</h3>
          {group.items.map((tx) => {
            const sent = tx.type === 'sent'
            const time = historyTime(tx.blockTime)
            const state =
              tx.account === 'spend'
                ? tx.confirmed
                  ? time
                    ? `Settled · ${time}`
                    : 'Settled'
                  : 'Preconfirmed'
                : tx.confirmed
                  ? time
                    ? `Confirmed · ${time}`
                    : 'Confirmed'
                  : 'Pending confirmation'
            return (
              <button
                type='button'
                key={`${tx.account}:${tx.txid}:${tx.type}`}
                className='vault-history-row'
                data-testid={`vault-tx-${tx.txid}`}
                aria-label={`${sent ? 'Sent' : 'Received'} ${prettyAmount(tx.amount)}. ${state}.`}
                onClick={() => {
                  hapticSubtle()
                  openTx(tx)
                }}
              >
                <span className='vault-history-icon' aria-hidden='true'>
                  {sent ? <SentIcon /> : <ReceivedIcon />}
                </span>
                <span className='vault-history-copy'>
                  <Text small bold>
                    {sent ? 'Sent' : 'Received'}
                  </Text>
                  <Text color='neutral-600' tiny>
                    {state}
                  </Text>
                </span>
                <span className={sent ? 'vault-history-amt' : 'vault-history-amt is-in'}>
                  {sent ? '−' : '+'}
                  {prettyAmount(tx.amount)}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </section>
  )
}

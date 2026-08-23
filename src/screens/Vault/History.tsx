import { useContext } from 'react'
import Text from '../../components/Text'
import ReceivedIcon from '../../icons/Received'
import SentIcon from '../../icons/Sent'
import { prettyDate, prettyNumber } from '../../lib/format'
import { hapticSubtle } from '../../lib/haptics'
import { VaultContext } from '../../vault/context'

export default function VaultHistory() {
  const { history, openTx } = useContext(VaultContext)

  if (history.length === 0) {
    return (
      <div className='vault-history' data-testid='vault-history'>
        <Text color='neutral-600' tiny wrap>
          No transactions yet. Send or receive to see them here.
        </Text>
      </div>
    )
  }

  return (
    <div className='vault-history' data-testid='vault-history'>
      {history.map((tx, index) => {
        const sent = tx.type === 'sent'
        return (
          <button
            type='button'
            key={tx.txid}
            className='vault-history-row'
            data-testid={`vault-tx-${index}`}
            onClick={() => {
              hapticSubtle()
              openTx(tx)
            }}
          >
            <span className='vault-history-icon'>{sent ? <SentIcon /> : <ReceivedIcon />}</span>
            <span className='vault-history-copy'>
              <Text small bold>
                {sent ? 'Sent' : 'Received'}
              </Text>
              <Text color='neutral-600' tiny>
                {tx.confirmed && tx.blockTime ? prettyDate(tx.blockTime) : 'Unconfirmed'}
              </Text>
            </span>
            <span className={sent ? 'vault-history-amt' : 'vault-history-amt is-in'}>
              {sent ? '−' : '+'}
              {prettyNumber(tx.amount)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

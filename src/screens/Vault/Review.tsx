import { useContext, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useToast } from '../../components/Toast'
import { copyToClipboard } from '../../lib/clipboard'
import { prettyAmount, prettyNumber } from '../../lib/format'
import { isVaultLightningInput } from '../../lib/vault/lightningConfig'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../vault/context'
import QgScreen, { QgPrimary, QgTextButton } from './qg/QgScreen'

export default function VaultReview() {
  const { account, approveSend, boardingAddress, busy, error, navigate, spend, status } = useContext(VaultContext)
  const { toast } = useToast()
  const [revealed, setRevealed] = useState(false)
  const fromSavings = account === 'savings'
  const movingToSpending = fromSavings && Boolean(boardingAddress) && spend.address === boardingAddress
  const lightning = isVaultLightningInput(spend.address)
  const destinationType = movingToSpending ? 'Spending' : lightning ? 'Lightning invoice' : 'Address'
  const destinationValue = movingToSpending ? 'Spending' : spend.address
  const destinationShown =
    movingToSpending || lightning || revealed ? destinationValue : truncateAddress(destinationValue, 8)

  if (fromSavings && busy) {
    return (
      <div className='qg-screen qg-screen-progress'>
        <main className='qg-main qg-centered qg-progress-screen'>
          <span className='qg-spinner' aria-hidden='true' />
          <p className='qg-eyebrow'>Approval 1 of 2</p>
          <h1>Approve with passkey</h1>
          <p className='qg-copy'>Use Face ID, Touch ID, fingerprint, or your device PIN when prompted.</p>
        </main>
      </div>
    )
  }

  return (
    <QgScreen
      title='Review payment'
      back={() => navigate('send')}
      footer={
        <>
          {error ? (
            <p className='qg-footer-error' role='alert'>
              {error}
            </p>
          ) : null}
          <QgPrimary
            onClick={() => void approveSend()}
            disabled={busy}
            loading={busy}
            label={busy ? 'Waiting for passkey…' : fromSavings ? 'Sign on this device' : 'Approve payment'}
          />
        </>
      }
    >
      <section className='qg-review-amount'>
        <small>{movingToSpending ? 'You’re moving' : lightning ? 'You’re paying' : 'You’re sending'}</small>
        <strong>
          {prettyNumber(spend.amount, 0)} <span>₿SATS</span>
        </strong>
        <p>{fromSavings ? 'From Savings' : 'From Spending'}</p>
        <QgTextButton onClick={() => navigate('send')} label='Edit amount' />
      </section>
      <section className='qg-details' aria-label='Payment details'>
        <div>
          <span>To</span>
          <strong>
            <small className='qg-dest-type'>{destinationType}</small>
            {destinationShown}
          </strong>
        </div>
        {movingToSpending || lightning ? null : (
          <div className='qg-detail-actions'>
            <button
              type='button'
              className='qg-text'
              onClick={() => {
                void copyToClipboard(spend.address).then(() => toast('Address copied'))
              }}
            >
              Copy
            </button>
            <button type='button' className='qg-text' onClick={() => setRevealed((open) => !open)}>
              {revealed ? 'Hide' : 'Reveal'}
            </button>
            <button type='button' className='qg-text' onClick={() => navigate('send')}>
              Edit
            </button>
          </div>
        )}
        <div>
          <span>{fromSavings ? 'Network fee' : 'Fee'}</span>
          <strong>{prettyAmount(spend.fee)}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>{prettyAmount(spend.amount + spend.fee)}</strong>
        </div>
        <div>
          <span>Network</span>
          <strong>{status?.network === 'mainnet' ? 'Bitcoin' : 'Mutinynet'}</strong>
        </div>
      </section>
      <section className='qg-approvals' aria-labelledby='qg-approvals-heading'>
        <h3 id='qg-approvals-heading'>Next approval</h3>
        {fromSavings ? (
          <>
            <div>
              <b>1</b>
              <span>
                <strong>Passkey on this device</strong>
                <small>Signs first</small>
              </span>
            </div>
            <div>
              <b>2</b>
              <span>
                <strong>Hardware key</strong>
                <small>Signs next on the other device</small>
              </span>
            </div>
          </>
        ) : (
          <>
            <div>
              <span className='qg-approval-mark'>1</span>
              <p>
                <strong>You</strong>
                <small>Approve with passkey</small>
              </p>
            </div>
            <div>
              <span className='qg-approval-mark is-safe'>
                <ShieldCheck />
              </span>
              <p>
                <strong>Vault service</strong>
                <small>Automatic if this payment is within your limits</small>
              </p>
              <span className='qg-auto'>Automatic</span>
            </div>
          </>
        )}
      </section>
    </QgScreen>
  )
}

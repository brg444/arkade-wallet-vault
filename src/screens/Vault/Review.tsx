import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import Header from './Header'
import Padded from '../../components/Padded'
import { prettyAmount } from '../../lib/format'
import { isVaultLightningInput } from '../../lib/vault/lightningConfig'
import { VaultContext } from '../../vault/context'
import { Detail, SignerRow } from './ui'

export default function VaultReview() {
  const { account, approveSend, boardingAddress, busy, error, navigate, spend, status } = useContext(VaultContext)
  const fromSavings = account === 'savings'
  const movingToSpending = fromSavings && Boolean(boardingAddress) && spend.address === boardingAddress
  const lightning = isVaultLightningInput(spend.address)

  return (
    <>
      <Header text='Review payment' back={() => navigate('send')} />
      <Content noRefresh className='vault-review-content'>
        <Padded>
          <div className='vault-review'>
            <div className='vault-review-amount'>
              <p className='vault-kicker'>
                {movingToSpending ? 'You’re moving' : lightning ? 'You’re paying' : 'You’re sending'}
              </p>
              <p className='vault-money'>{prettyAmount(spend.amount)}</p>
              <p className='vault-review-source'>{fromSavings ? 'From Savings' : 'From Spending'}</p>
            </div>
            <section className='vault-review-receipt' aria-label='Payment details'>
              <p className='vault-review-receipt-label'>Payment details</p>
              <Detail
                label='To'
                value={movingToSpending ? 'Spending' : lightning ? 'Lightning' : spend.address}
                mono={!movingToSpending && !lightning}
              />
              <Detail label='Fee' value={prettyAmount(spend.fee)} />
              <Detail label='Total' value={prettyAmount(spend.amount + spend.fee)} />
              <Detail label='Network' value={status?.network === 'mutinynet' ? 'Mutinynet' : 'Test network'} />
            </section>
            <section className='vault-review-approvals' aria-label='Required approvals'>
              <p className='vault-section-label'>Approvals</p>
              <SignerRow title='You' detail='Device unlock' state='you' mark='1' />
              {fromSavings ? (
                <SignerRow title='Hardware' detail='Signs next, on the other device' state='you' mark='2' />
              ) : (
                <>
                  <SignerRow title='Vault service' detail='Approves within your enrolled limits' state='auto' />
                  <SignerRow title='Hardware' detail='Not needed for this send' state='unused' />
                </>
              )}
            </section>
            <ErrorMessage error={Boolean(error)} text={error} />
          </div>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button
          className='vault-commit-action'
          onClick={approveSend}
          disabled={busy}
          loading={busy}
          label={busy ? 'Waiting for device unlock…' : fromSavings ? 'Sign on this device' : 'Approve'}
        />
      </ButtonsOnBottom>
    </>
  )
}

import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import { prettyAmount } from '../../lib/format'
import { isCoarsePhone } from '../../lib/vault/webauthn'
import { VaultContext } from '../../vault/context'
import { Detail, SignerRow } from './ui'

export default function VaultReview() {
  const { account, approveSend, boardingAddress, busy, error, navigate, spend } = useContext(VaultContext)
  const onPhone = isCoarsePhone()
  const fromSavings = account === 'savings'
  const movingToSpending = fromSavings && Boolean(boardingAddress) && spend.address === boardingAddress

  return (
    <>
      <Header text='Review' back={() => navigate('send')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <div className='vault-hero'>
              <p className='vault-kicker'>{movingToSpending ? 'You’re moving' : 'You’re sending'}</p>
              <p className='vault-money'>{prettyAmount(spend.amount)}</p>
            </div>
            <Detail label='To' value={movingToSpending ? 'Spending' : spend.address} mono={!movingToSpending} />
            <Detail label='Fee' value={prettyAmount(spend.fee)} />
            <Detail label='Total' value={prettyAmount(spend.amount + spend.fee)} />
            <SignerRow title='You' detail={onPhone ? 'Face ID' : 'Your passkey'} state='you' mark='1' />
            {fromSavings ? (
              <SignerRow title='Hardware' detail='Signs next, on the other device' state='you' mark='2' />
            ) : (
              <>
                <SignerRow title='Vault service' detail='Approves if under today’s limit' state='auto' />
                <SignerRow title='Hardware' detail='Not needed for this send' state='unused' />
              </>
            )}
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button
          onClick={approveSend}
          disabled={busy}
          loading={busy}
          label={
            busy
              ? onPhone
                ? 'Waiting for Face ID…'
                : 'Waiting for passkey…'
              : fromSavings
                ? 'Sign on this device'
                : 'Approve'
          }
        />
      </ButtonsOnBottom>
    </>
  )
}

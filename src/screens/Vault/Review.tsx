import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import { prettyAmount } from '../../lib/format'
import { isCoarsePhone } from '../../lib/vault/webauthn'
import { VaultContext } from '../../providers/vault'
import { Detail, SignerRow } from './ui'

export default function VaultReview() {
  const { approvePreviewSend, busy, error, navigate, preview, spend } = useContext(VaultContext)
  const onPhone = isCoarsePhone()

  return (
    <>
      <Header text='Review' back={() => navigate('send')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <div className='vault-hero'>
              <p className='vault-kicker'>You're sending</p>
              <p className='vault-money'>{prettyAmount(spend.amount)}</p>
            </div>
            <Detail label='To' value={spend.address} mono />
            <Detail label='Fee' value={prettyAmount(spend.fee)} />
            <Detail label='Total' value={prettyAmount(spend.amount + spend.fee)} />
            <SignerRow
              title='You'
              detail={preview ? 'No passkey in preview' : onPhone ? 'Face ID' : 'Your passkey'}
              state='you'
            />
            <SignerRow title='Vault' detail='Approves if under today’s limit' state='auto' />
            <SignerRow title='Hardware' detail='Not needed for this send' state='unused' />
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button
          onClick={approvePreviewSend}
          disabled={busy}
          loading={busy}
          label={busy ? (onPhone ? 'Waiting for Face ID…' : 'Waiting for passkey…') : preview ? 'Send' : 'Approve'}
        />
      </ButtonsOnBottom>
    </>
  )
}

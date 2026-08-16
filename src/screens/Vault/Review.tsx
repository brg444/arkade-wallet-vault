import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import { prettyAmount } from '../../lib/format'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../providers/vault'
import { Detail, Pill, SignerRow } from './ui'

export default function VaultReview() {
  const { approvePreviewSend, busy, error, liveNetwork, navigate, preview, spend } = useContext(VaultContext)

  return (
    <>
      <Header text='Review' back={() => navigate('send')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text heading big>
              {prettyAmount(spend.amount)}
            </Text>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Pill>Daily phone path</Pill>
              {liveNetwork ? <Pill>Broadcasts on Mutinynet</Pill> : <Pill>Preview only</Pill>}
            </div>
            <Detail label='To' value={spend.address} mono />
            <Detail label='Network fee' value={prettyAmount(spend.fee)} />
            <Detail label='Total' value={prettyAmount(spend.amount + spend.fee)} />
            <Text color='neutral-600' tiny wrap>
              {truncateAddress(spend.address, 8)}
            </Text>
            <Text small bold>
              Who signs
            </Text>
            <SignerRow
              title='You · this phone'
              detail={preview ? 'Preview confirm — no passkey' : 'Approve with your passkey'}
              state='you'
            />
            <SignerRow title='Vault service' detail='Cosigns if this send is inside today’s limit' state='auto' />
            <SignerRow title='Hardware' detail='Not used for this payment' state='unused' />
            <Text color='neutral-600' small wrap>
              {preview
                ? 'This uses the phone path only. Demo coins are not on a chain. Hardware plus recovery would still be required to sweep the vault.'
                : liveNetwork
                  ? 'This broadcasts a real Mutinynet transaction from the spending address. Savings and the hardware key stay unused.'
                  : 'This uses today’s phone limit, not savings or the hardware key.'}
            </Text>
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button
          onClick={approvePreviewSend}
          disabled={busy}
          loading={busy}
          label={busy ? 'Signing…' : preview ? 'Looks good' : 'Approve with passkey'}
        />
      </ButtonsOnBottom>
    </>
  )
}

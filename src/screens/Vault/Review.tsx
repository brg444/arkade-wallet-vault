import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import { prettyAmount } from '../../lib/format'
import { VaultContext } from '../../providers/vault'

function Line({ label, value }: { label: string; value: string }) {
  return (
    <FlexCol gap='0.15rem'>
      <Text color='neutral-600' tiny>
        {label}
      </Text>
      <Text small wrap>
        {value}
      </Text>
    </FlexCol>
  )
}

export default function VaultReview() {
  const { approvePreviewSend, navigate, preview, spend } = useContext(VaultContext)

  return (
    <>
      <Header text='Review' back={() => navigate('send')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text heading big>
              {prettyAmount(spend.amount)}
            </Text>
            <Line label='To' value={spend.address} />
            <Line label='Network fee' value={prettyAmount(spend.fee)} />
            <Line label='Total' value={prettyAmount(spend.amount + spend.fee)} />
            <Text color='neutral-600' small wrap>
              {preview
                ? 'This is a preview. Nothing is broadcast. On a live vault you would approve with your passkey now.'
                : 'Approve with your passkey to send. This uses today’s spending limit, not savings.'}
            </Text>
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={approvePreviewSend} label={preview ? 'Looks good' : 'Approve with passkey'} />
      </ButtonsOnBottom>
    </>
  )
}

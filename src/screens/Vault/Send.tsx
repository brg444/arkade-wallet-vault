import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Input from '../../components/Input'
import InputAddress from '../../components/InputAddress'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import { prettyAmount } from '../../lib/format'
import { isVaultBitcoinAddress } from '../../lib/vault/bitcoin'
import { VaultContext } from '../../providers/vault'

export default function VaultSend() {
  const { amountSats, error, navigate, reviewSpend, setSpendDraft, spend } = useContext(VaultContext)

  return (
    <>
      <Header text='Send' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text color='neutral-600' small>
              Available {prettyAmount(amountSats)}
            </Text>
            <InputAddress
              label='To'
              placeholder='Bitcoin address'
              value={spend.address}
              onChange={(value: string) => setSpendDraft({ address: value.trim() })}
              openScan={() => {}}
              validator={isVaultBitcoinAddress}
            />
            <Input
              label='Amount (sats)'
              type='number'
              min='330'
              value={spend.amount || ''}
              onChange={(value: string) => setSpendDraft({ amount: Number(value) || 0 })}
              placeholder='20000'
              testId='vault-send-amount'
            />
            <Text color='neutral-600' tiny wrap>
              Network fee {prettyAmount(spend.fee)}. Max 50,000 sats per payment. Use a confirmed Mutinynet coin.
            </Text>
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={reviewSpend} label='Continue' />
      </ButtonsOnBottom>
    </>
  )
}

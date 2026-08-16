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
import { Meter, Pill } from './ui'

export default function VaultSend() {
  const { amountSats, dailyRemaining, error, liveNetwork, navigate, reviewSpend, setSpendDraft, spend, setup } =
    useContext(VaultContext)
  const used = Math.max(0, setup.dailyLimitSats - dailyRemaining)
  const ratio = setup.dailyLimitSats > 0 ? Math.min(1, used / setup.dailyLimitSats) : 0

  return (
    <>
      <Header text='Send' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Pill>Daily phone path</Pill>
              <Pill>{prettyAmount(amountSats)} available</Pill>
            </div>
            <Text wrap>This uses today’s phone limit and your passkey. Hardware and savings stay unused.</Text>
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
              Network fee {prettyAmount(spend.fee)}. Max {prettyAmount(setup.txCapSats)} per payment.
              {liveNetwork ? ' Use a confirmed Mutinynet coin.' : ''}
            </Text>
            <Text color='neutral-600' tiny>
              Phone may spend {prettyAmount(dailyRemaining)} of {prettyAmount(setup.dailyLimitSats)} today
            </Text>
            <Meter ratio={ratio} label='Daily spending remaining' />
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={reviewSpend} label='Review this send' />
      </ButtonsOnBottom>
    </>
  )
}

import { useContext, useEffect, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Input from '../../components/Input'
import InputAddress from '../../components/InputAddress'
import Padded from '../../components/Padded'
import Scanner from '../../components/Scanner'
import Text from '../../components/Text'
import { decodeBip21, isBip21 } from '../../lib/bip21'
import { prettyAmount, prettyNumber } from '../../lib/format'
import { isVaultSpendAddress } from '../../lib/vault/bitcoin'
import { VaultContext } from '../../providers/vault'
import { Meter } from './ui'

function payloadFromScan(raw: string): { address: string; amount?: number } {
  const trimmed = raw.trim()
  if (isBip21(trimmed)) {
    try {
      const decoded = decodeBip21(trimmed)
      return {
        address: (decoded.arkAddress || decoded.address || '').trim(),
        amount: decoded.satoshis,
      }
    } catch {
      return { address: trimmed }
    }
  }
  return { address: trimmed }
}

export default function VaultSend() {
  const {
    account,
    amountSats,
    clearSendScan,
    dailyRemaining,
    error,
    navigate,
    reviewSpend,
    scanOnSend,
    setSpendDraft,
    spend,
    setup,
    status,
    preview,
    savingsSats,
  } = useContext(VaultContext)
  const fromSavings = account === 'savings'
  const destNetwork = status?.network || (preview ? 'regtest' : 'mutinynet')
  const [scan, setScan] = useState(false)
  const availableSpend = Math.max(0, Math.min(dailyRemaining, amountSats))
  const used = Math.max(0, setup.dailyLimitSats - availableSpend)
  const ratio = setup.dailyLimitSats > 0 ? Math.min(1, used / setup.dailyLimitSats) : 0

  useEffect(() => {
    if (!scanOnSend) return
    setScan(true)
    clearSendScan()
  }, [scanOnSend, clearSendScan])

  if (scan) {
    return (
      <Scanner
        close={() => setScan(false)}
        label='Bitcoin address'
        onData={(data) => {
          const next = payloadFromScan(data)
          setSpendDraft({
            address: next.address,
            ...(next.amount ? { amount: next.amount } : {}),
          })
          setScan(false)
        }}
        onError={() => setScan(false)}
      />
    )
  }

  return (
    <>
      <Header text={fromSavings ? 'Send from Savings' : 'Send'} back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Input
              label='Amount (sats)'
              type='number'
              min='330'
              value={spend.amount || ''}
              onChange={(value: string) => setSpendDraft({ amount: Number(value) || 0 })}
              placeholder='20000'
              testId='vault-send-amount'
            />
            <InputAddress
              label='To'
              placeholder='Arkade or Bitcoin address'
              value={spend.address}
              onChange={(value: string) => setSpendDraft({ address: value.trim() })}
              openScan={() => setScan(true)}
              validator={(value) => isVaultSpendAddress(value, destNetwork)}
            />
            <Text color='neutral-600' tiny wrap>
              {fromSavings
                ? `From Savings · fee ${prettyAmount(spend.fee)}. This device signs first. Hardware signs next.`
                : `Fee ${prettyAmount(spend.fee)} · up to ${prettyAmount(setup.txCapSats)} per send`}
            </Text>
            {fromSavings ? (
              <Text color='neutral-600' tiny>
                {prettyNumber(savingsSats, 0)} sats in savings
              </Text>
            ) : (
              <>
                <Text color='neutral-600' tiny>
                  {prettyNumber(availableSpend, 0)} / {prettyNumber(setup.dailyLimitSats, 0)} available today
                </Text>
                <Meter ratio={ratio} label='Daily limit used' />
              </>
            )}
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={reviewSpend} label='Review' />
      </ButtonsOnBottom>
    </>
  )
}

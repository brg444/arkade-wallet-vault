import { useContext, useEffect, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Input from '../../components/Input'
import Padded from '../../components/Padded'
import Scanner from './Scanner'
import Text from '../../components/Text'
import { prettyAmount, prettyNumber } from '../../lib/format'
import { decodeVaultBip21, isVaultBip21 } from '../../lib/vault/bip21'
import { isVaultSpendAddress } from '../../lib/vault/bitcoin'
import { VaultContext } from '../../providers/vault'
import AddressInput from './AddressInput'
import { Meter } from './ui'

function payloadFromScan(raw: string): { address: string; amount?: number } {
  const trimmed = raw.trim()
  if (isVaultBip21(trimmed)) {
    try {
      const decoded = decodeVaultBip21(trimmed)
      return {
        address: (decoded.arkadeAddress || decoded.bitcoinAddress || '').trim(),
        amount: decoded.satoshis,
      }
    } catch {
      return { address: trimmed }
    }
  }
  return { address: trimmed }
}

function isVaultSendInput(value: string, network: string): boolean {
  if (isVaultSpendAddress(value, network)) return true
  if (!isVaultBip21(value)) return false
  const decoded = decodeVaultBip21(value)
  return isVaultSpendAddress(decoded.arkadeAddress || decoded.bitcoinAddress, network)
}

export default function VaultSend() {
  const {
    account,
    amountSats,
    boardingAddress,
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
  const movingToSpending = fromSavings && Boolean(boardingAddress) && spend.address === boardingAddress
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
      <Header
        text={movingToSpending ? 'Move to Spending' : fromSavings ? 'Send from Savings' : 'Send'}
        back={() => navigate('home')}
      />
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
            <AddressInput
              label='To'
              placeholder={fromSavings ? 'Bitcoin address' : 'Arkade address'}
              value={spend.address}
              onChange={(value: string) => {
                const next = payloadFromScan(value)
                setSpendDraft({
                  address: next.address,
                  ...(next.amount === undefined ? {} : { amount: next.amount }),
                })
              }}
              openScan={() => setScan(true)}
              validator={(value) => isVaultSendInput(value, destNetwork)}
            />
            <Text color='neutral-600' tiny wrap>
              {fromSavings
                ? movingToSpending
                  ? `To Spending · fee ${prettyAmount(spend.fee)}. This device signs first. Hardware signs next.`
                  : `From Savings · fee ${prettyAmount(spend.fee)}. This device signs first. Hardware signs next.`
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

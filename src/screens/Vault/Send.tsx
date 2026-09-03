import { useContext, useEffect, useState } from 'react'
import type { NetworkName } from '@arkade-os/sdk'
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
import {
  isVaultLightningInput,
  vaultLightningSendEnabled,
  vaultLightningSolverProfile,
} from '../../lib/vault/lightningConfig'
import { decodeVaultLightningInvoice } from '../../lib/vault/lightningInvoice'
import { VaultContext } from '../../vault/context'
import AddressInput from './AddressInput'
import { Meter } from './ui'

function lightningInvoice(value: string, network?: string) {
  if (!network || !vaultLightningSendEnabled(network as NetworkName) || !isVaultLightningInput(value)) return undefined
  const profile = vaultLightningSolverProfile(network as NetworkName)
  if (!profile) return undefined
  try {
    return decodeVaultLightningInvoice(value, profile.network)
  } catch {
    return undefined
  }
}

function payloadFromScan(raw: string, allowLightning = true): { address: string; amount?: number } {
  const trimmed = raw.trim()
  if (isVaultBip21(trimmed)) {
    try {
      const decoded = decodeVaultBip21(trimmed)
      return {
        address: (
          (allowLightning ? decoded.lightning : '') ||
          decoded.arkadeAddress ||
          decoded.bitcoinAddress ||
          ''
        ).trim(),
        amount: decoded.satoshis,
      }
    } catch {
      return { address: trimmed }
    }
  }
  return { address: trimmed }
}

function isVaultSendInput(value: string, network?: string, allowLightning = true): boolean {
  if (isVaultLightningInput(value)) return allowLightning && Boolean(lightningInvoice(value, network))
  if (isVaultSpendAddress(value, network)) return true
  if (!isVaultBip21(value)) return false
  const decoded = decodeVaultBip21(value)
  return isVaultSpendAddress(decoded.arkadeAddress || decoded.bitcoinAddress, network)
}

export default function VaultSend() {
  const {
    account,
    boardingAddress,
    busy,
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
    positions,
  } = useContext(VaultContext)
  const fromSavings = account === 'savings'
  const movingToSpending = fromSavings && Boolean(boardingAddress) && spend.address === boardingAddress
  const destNetwork = status?.network
  const lightning = !fromSavings && Boolean(lightningInvoice(spend.address, destNetwork))
  const [scan, setScan] = useState(false)
  const availableSpend = Math.max(0, Math.min(dailyRemaining, positions.spending.availableSats))
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
        label={fromSavings ? 'Bitcoin address' : 'Payment request'}
        onData={(data) => {
          const next = payloadFromScan(data, !fromSavings)
          const lightningAmount = fromSavings ? undefined : lightningInvoice(next.address, destNetwork)?.amountSats
          setSpendDraft({
            address: next.address,
            ...(lightningAmount || next.amount ? { amount: lightningAmount || next.amount } : {}),
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
      <Content noRefresh className='vault-send-content'>
        <Padded>
          <FlexCol className='vault-send-form'>
            <Input
              className='vault-send-amount-input'
              label='Amount (sats)'
              type='number'
              min='330'
              value={spend.amount || ''}
              readOnly={lightning}
              onChange={(value: string) => setSpendDraft({ amount: Number(value) || 0 })}
              placeholder='20000'
              testId='vault-send-amount'
            />
            <AddressInput
              label='To'
              placeholder={fromSavings ? 'Bitcoin address' : 'Arkade address or Lightning invoice'}
              value={spend.address}
              onChange={(value: string) => {
                const next = payloadFromScan(value, !fromSavings)
                const lightningAmount = fromSavings
                  ? undefined
                  : lightningInvoice(next.address, destNetwork)?.amountSats
                setSpendDraft({
                  address: next.address,
                  ...(lightningAmount === undefined && next.amount === undefined
                    ? {}
                    : { amount: lightningAmount ?? next.amount }),
                })
              }}
              openScan={() => setScan(true)}
              validator={(value) => isVaultSendInput(value, destNetwork, !fromSavings)}
            />
            <Text color='neutral-600' tiny wrap>
              {fromSavings
                ? movingToSpending
                  ? `Moving to Spending costs ${prettyAmount(spend.fee)} and requires this device to sign before your hardware key.`
                  : `Sending from Savings costs ${prettyAmount(spend.fee)} and requires this device to sign before your hardware key.`
                : lightning
                  ? 'The solver and VTXO fees appear on the next screen.'
                  : `Spending allows up to ${prettyAmount(setup.txCapSats)} per payment, and the fee appears on the next screen.`}
            </Text>
            {fromSavings ? (
              <Text color='neutral-600' tiny>
                {prettyNumber(positions.savings.availableSats, 0)} sats available to move
              </Text>
            ) : (
              <>
                <Text color='neutral-600' tiny>
                  {prettyNumber(availableSpend, 0)} remaining of {prettyNumber(setup.dailyLimitSats, 0)} in your rolling
                  24-hour limit
                </Text>
                <Meter ratio={ratio} label='Rolling 24-hour limit used' />
              </>
            )}
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button
          className='vault-commit-action'
          onClick={reviewSpend}
          disabled={busy}
          loading={busy}
          label={
            busy
              ? 'Confirming fee…'
              : movingToSpending
                ? 'Review move'
                : fromSavings
                  ? 'Review transfer'
                  : 'Review payment'
          }
        />
      </ButtonsOnBottom>
    </>
  )
}

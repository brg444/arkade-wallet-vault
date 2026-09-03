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
              label='Amount'
              type='number'
              min='330'
              value={spend.amount || ''}
              readOnly={lightning}
              onChange={(value: string) => setSpendDraft({ amount: Number(value) || 0 })}
              placeholder='20,000'
              testId='vault-send-amount'
            />
            {fromSavings ? (
              <p className='vault-send-available'>
                {prettyNumber(positions.savings.availableSats, 0)} sats available to move
              </p>
            ) : (
              <section className='vault-send-capacity' aria-label='Spending capacity'>
                <div>
                  <span>Available</span>
                  <strong>{prettyNumber(positions.spending.availableSats, 0)} sats</strong>
                </div>
                <div>
                  <span>Rolling 24-hour limit</span>
                  <strong>
                    {prettyNumber(availableSpend, 0)} of {prettyNumber(setup.dailyLimitSats, 0)} remaining
                  </strong>
                </div>
                <Meter ratio={ratio} label='Rolling 24-hour limit used' />
              </section>
            )}
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
            {fromSavings ? (
              <div className='vault-send-note'>
                <span aria-hidden='true'>2</span>
                <div>
                  <strong>Two approvals are required</strong>
                  <p>Your passkey signs first. Your hardware key signs next.</p>
                </div>
              </div>
            ) : (
              <Text color='neutral-600' tiny wrap>
                {lightning
                  ? 'The solver and VTXO fees appear before approval.'
                  : `Up to ${prettyAmount(setup.txCapSats)} per payment. The fee appears before approval.`}
              </Text>
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

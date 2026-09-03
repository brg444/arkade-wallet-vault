import { useContext, useEffect, useState } from 'react'
import type { NetworkName } from '@arkade-os/sdk'
import { KeyRound, ScanLine } from 'lucide-react'
import ErrorMessage from '../../components/Error'
import { prettyAmount, prettyNumber } from '../../lib/format'
import { decodeVaultBip21, isVaultBip21 } from '../../lib/vault/bip21'
import {
  isVaultLightningInput,
  vaultLightningSendEnabled,
  vaultLightningSolverProfile,
} from '../../lib/vault/lightningConfig'
import { decodeVaultLightningInvoice } from '../../lib/vault/lightningInvoice'
import { VaultContext } from '../../vault/context'
import Scanner from './Scanner'
import QgScreen, { QgPrimary } from './qg/QgScreen'

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
  const [scan, setScan] = useState(Boolean(scanOnSend))
  const availableSpend = Math.max(0, Math.min(dailyRemaining, positions.spending.availableSats))
  const used = Math.max(0, setup.dailyLimitSats - availableSpend)
  const ratio = setup.dailyLimitSats > 0 ? Math.min(1, used / setup.dailyLimitSats) : 0
  const available = fromSavings ? positions.savings.availableSats : availableSpend
  const amountError =
    spend.amount <= 0
      ? ''
      : spend.amount < 330
        ? 'The smallest send is 330 sats.'
        : spend.amount > available
          ? fromSavings
            ? 'That is more than Savings can move now.'
            : 'That is more than you can send now.'
          : !fromSavings && spend.amount > setup.txCapSats
            ? `Up to ${prettyAmount(setup.txCapSats)} per payment.`
            : ''

  useEffect(() => {
    if (!scanOnSend) return
    setScan(true)
  }, [scanOnSend])

  const closeScan = () => {
    if (scanOnSend) {
      clearSendScan()
      navigate('home')
      return
    }
    setScan(false)
  }

  const setAmount = (raw: string) => {
    const digits = raw.replace(/\D/g, '')
    setSpendDraft({ amount: Number(digits) || 0 })
  }

  const setAddress = (value: string) => {
    const next = payloadFromScan(value, !fromSavings)
    const lightningAmount = fromSavings ? undefined : lightningInvoice(next.address, destNetwork)?.amountSats
    setSpendDraft({
      address: next.address,
      ...(lightningAmount === undefined && next.amount === undefined ? {} : { amount: lightningAmount ?? next.amount }),
    })
  }

  if (scan) {
    return (
      <Scanner
        close={closeScan}
        label={fromSavings ? 'Scan Bitcoin address' : 'Scan payment'}
        onData={(data) => {
          const next = payloadFromScan(data, !fromSavings)
          const lightningAmount = fromSavings ? undefined : lightningInvoice(next.address, destNetwork)?.amountSats
          setSpendDraft({
            address: next.address,
            ...(lightningAmount || next.amount ? { amount: lightningAmount || next.amount } : {}),
          })
          clearSendScan()
          setScan(false)
        }}
        onError={closeScan}
      />
    )
  }

  return (
    <QgScreen
      title={movingToSpending ? 'Move to Spending' : fromSavings ? 'Send from Savings' : 'Send'}
      dismiss={() => navigate('home')}
      footer={
        <>
          <ErrorMessage error={Boolean(error)} text={error} />
          <QgPrimary
            onClick={() => void reviewSpend()}
            disabled={busy || Boolean(amountError) || spend.amount <= 0}
            loading={busy}
            label={
              busy
                ? 'Confirming fee…'
                : movingToSpending
                  ? 'Review move'
                  : fromSavings
                    ? 'Review send'
                    : 'Review payment'
            }
          />
        </>
      }
    >
      <section className='qg-amount-entry'>
        <label htmlFor='qg-send-amount'>Amount</label>
        <div>
          <input
            id='qg-send-amount'
            value={spend.amount ? prettyNumber(spend.amount, 0) : ''}
            inputMode='numeric'
            readOnly={lightning}
            data-testid='vault-send-amount'
            placeholder='20,000'
            onChange={(event) => setAmount(event.target.value)}
          />
          <span>SATS</span>
          {lightning ? null : (
            <button type='button' className='qg-max' onClick={() => setSpendDraft({ amount: available })}>
              Max
            </button>
          )}
        </div>
        {amountError ? (
          <p className='qg-field-error' role='alert'>
            {amountError}
          </p>
        ) : null}
      </section>
      <label className='qg-dest-field'>
        <span>To</span>
        <div>
          <input
            value={spend.address}
            aria-label='To'
            name='vault-send-destination'
            autoComplete='off'
            autoCapitalize='none'
            autoCorrect='off'
            spellCheck={false}
            enterKeyHint='done'
            placeholder={fromSavings ? 'Bitcoin address' : 'Arkade address or Lightning invoice'}
            onChange={(event) => setAddress(event.target.value)}
          />
          <button type='button' aria-label='Scan destination' onClick={() => setScan(true)}>
            <ScanLine />
          </button>
        </div>
        {fromSavings ? <small>Bitcoin address</small> : null}
      </label>
      {fromSavings ? (
        <p className='qg-available'>{prettyNumber(positions.savings.availableSats, 0)} sats available to move</p>
      ) : (
        <section className='qg-capacity' aria-label='Spending capacity'>
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
          <div
            className='qg-meter'
            role='progressbar'
            aria-label='Rolling 24-hour limit used'
            aria-valuenow={Math.round(ratio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
        </section>
      )}
      {fromSavings ? (
        <section className='qg-note'>
          <KeyRound />
          <div>
            <strong>Two approvals are required</strong>
            <p>Your passkey signs first. Your hardware key signs next.</p>
          </div>
        </section>
      ) : (
        <p className='qg-helper'>
          {lightning
            ? 'The solver and VTXO fees appear before approval.'
            : `Up to ${prettyAmount(setup.txCapSats)} per payment. The fee appears before approval.`}
        </p>
      )}
    </QgScreen>
  )
}

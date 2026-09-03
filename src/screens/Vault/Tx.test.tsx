import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultTx from './Tx'

function renderTx(selectedTx: VaultContextProps['selectedTx']) {
  const retryLightningRefund = vi.fn(async () => {})
  render(
    <VaultContext.Provider
      value={
        {
          navigate: vi.fn(),
          retryLightningRefund,
          selectedTx,
          status: { network: 'mutinynet' },
        } as unknown as VaultContextProps
      }
    >
      <VaultTx />
    </VaultContext.Provider>,
  )
  return { retryLightningRefund }
}

describe('Vault transaction details', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses pending language and links Spending activity to Arkade Space', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderTx({
      txid: 'ark-transaction',
      type: 'received',
      amount: 12_000,
      confirmed: false,
      blockTime: 10,
      account: 'spend',
    })

    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    expect(screen.getByText('Mutinynet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View on Arkade Space' }))
    expect(open).toHaveBeenCalledWith(
      'https://explorer.mutinynet.arkade.sh/tx/ark-transaction',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('uses Bitcoin confirmation language and links Savings transactions', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderTx({
      txid: 'bitcoin-transaction',
      type: 'sent',
      amount: 8_000,
      confirmed: true,
      blockTime: 10,
      account: 'savings',
    })

    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'View on Bitcoin explorer' }))
    expect(open).toHaveBeenCalledWith(
      'https://mempool.mutinynet.arkade.sh/tx/bitcoin-transaction',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('keeps boarding activity pending and links it to the Bitcoin transaction', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderTx({
      txid: 'boarding-transaction',
      type: 'received',
      amount: 50_000,
      confirmed: false,
      account: 'spend',
      activity: 'boarding',
    })

    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'View on Bitcoin explorer' }))
    expect(open).toHaveBeenCalledWith(
      'https://mempool.mutinynet.arkade.sh/tx/boarding-transaction',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('shows settled boarding activity as confirmed', () => {
    renderTx({
      txid: 'settled-boarding-transaction',
      type: 'received',
      amount: 50_000,
      confirmed: true,
      account: 'spend',
      activity: 'boarding',
    })

    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0)
    expect(screen.queryByText('Pending')).toBeNull()
  })

  it('offers one passkey-backed return action only when the package says a refund is due', () => {
    const { retryLightningRefund } = renderTx({
      txid: 'ark-lightning-funding',
      type: 'sent',
      amount: 2_125,
      displayAmount: 2_100,
      confirmed: true,
      account: 'spend',
      activity: 'lightning',
      lightningState: 'needs_counterparty',
      lightningRfqId: 'rfq-1',
    })

    expect(screen.getAllByText('Ready to return').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Return to Spending' }))
    expect(retryLightningRefund).toHaveBeenCalledExactlyOnceWith('rfq-1')
  })

  it('describes a terminal failed Lightning payment as needing recovery', () => {
    renderTx({
      txid: 'ark-lightning-failed',
      type: 'sent',
      amount: 2_125,
      confirmed: true,
      account: 'spend',
      activity: 'lightning',
      lightningState: 'failed',
      lightningRfqId: 'rfq-failed',
    })

    expect(screen.getAllByText('Needs recovery').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Return to Spending' })).toBeNull()
  })
})

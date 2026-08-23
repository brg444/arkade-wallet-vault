import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultTx from './Tx'

function renderTx(selectedTx: VaultContextProps['selectedTx']) {
  render(
    <VaultContext.Provider
      value={
        {
          navigate: vi.fn(),
          selectedTx,
          status: { network: 'mutinynet' },
        } as unknown as VaultContextProps
      }
    >
      <VaultTx />
    </VaultContext.Provider>,
  )
}

describe('Vault transaction details', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses Arkade settlement language and links Spending activity to Arkade Space', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderTx({
      txid: 'ark-transaction',
      type: 'received',
      amount: 12_000,
      confirmed: false,
      blockTime: 10,
      account: 'spend',
    })

    expect(screen.getByText('Preconfirmed')).toBeTruthy()
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

    expect(screen.getByText('Confirmed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View on Bitcoin explorer' }))
    expect(open).toHaveBeenCalledWith(
      'https://mempool.mutinynet.arkade.sh/tx/bitcoin-transaction',
      '_blank',
      'noopener,noreferrer',
    )
  })
})

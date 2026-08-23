import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultTx from './Tx'

function renderTx(selectedTx: VaultContextProps['selectedTx']) {
  render(
    <VaultContext.Provider
      value={
        {
          liveNetwork: true,
          navigate: vi.fn(),
          selectedTx,
        } as unknown as VaultContextProps
      }
    >
      <VaultTx />
    </VaultContext.Provider>,
  )
}

describe('Vault transaction details', () => {
  it('uses Arkade settlement language and does not link an offchain id to the Bitcoin explorer', () => {
    renderTx({
      txid: 'ark-transaction',
      type: 'received',
      amount: 12_000,
      confirmed: false,
      blockTime: 10,
      account: 'spend',
    })

    expect(screen.getByText('Preconfirmed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'View on explorer' })).toBeNull()
  })

  it('uses Bitcoin confirmation language and links Savings transactions', () => {
    renderTx({
      txid: 'bitcoin-transaction',
      type: 'sent',
      amount: 8_000,
      confirmed: true,
      blockTime: 10,
      account: 'savings',
    })

    expect(screen.getByText('Confirmed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View on explorer' })).toBeTruthy()
  })
})

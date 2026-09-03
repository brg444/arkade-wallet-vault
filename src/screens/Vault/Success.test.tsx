import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultSuccess from './Success'

function renderSuccess(lastTxKind: VaultContextProps['lastTxKind']) {
  render(
    <VaultContext.Provider
      value={
        {
          boardingAddress: 'tb1pboarding',
          lastSend: { address: 'tark1destination', amount: 12_000, fee: 0 },
          lastTxid: 'transaction-id',
          lastTxKind,
          navigate: vi.fn(),
          status: { network: 'mutinynet' },
        } as unknown as VaultContextProps
      }
    >
      <VaultSuccess />
    </VaultContext.Provider>,
  )
}

describe('Vault send success explorer', () => {
  afterEach(() => vi.restoreAllMocks())

  it('links a VTXO send to Arkade Space', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderSuccess('vtxo')

    expect(screen.getByText('Payment sent')).toBeInTheDocument()
    expect(screen.getByText('Fast transfer complete')).toBeInTheDocument()
    expect(screen.getByText('VTXO identifier')).toBeInTheDocument()
    expect(screen.getByText('Mutinynet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View on Arkade Space' }))
    expect(open).toHaveBeenCalledWith(
      'https://explorer.mutinynet.arkade.sh/tx/transaction-id',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('links an onchain send to the Bitcoin explorer', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderSuccess('onchain')

    expect(screen.getByText('Savings transfer submitted')).toBeInTheDocument()
    expect(screen.getByText('Bitcoin confirmation is next')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View on Bitcoin explorer' }))
    expect(open).toHaveBeenCalledWith(
      'https://mempool.mutinynet.arkade.sh/tx/transaction-id',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('reports Lightning funding as started and links its VTXO transaction', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    renderSuccess('lightning')

    expect(screen.getByText('Payment started')).toBeInTheDocument()
    expect(screen.getByText('Quote accepted. The Lightning payment is completing.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View on Arkade Space' }))
    expect(open).toHaveBeenCalledWith(
      'https://explorer.mutinynet.arkade.sh/tx/transaction-id',
      '_blank',
      'noopener,noreferrer',
    )
  })
})

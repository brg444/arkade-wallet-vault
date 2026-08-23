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

    fireEvent.click(screen.getByRole('button', { name: 'View on Bitcoin explorer' }))
    expect(open).toHaveBeenCalledWith(
      'https://mempool.mutinynet.arkade.sh/tx/transaction-id',
      '_blank',
      'noopener,noreferrer',
    )
  })
})

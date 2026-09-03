import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultSend from './Send'

vi.mock('../../lib/haptics', () => ({
  hapticLight: vi.fn(),
  hapticSubtle: vi.fn(),
}))

vi.mock('./Scanner', () => ({
  default: ({ close, label }: { close: () => void; label: string }) => (
    <div>
      <h2>{label}</h2>
      <button type='button' onClick={close}>
        Cancel
      </button>
    </div>
  ),
}))

function renderSend(overrides: Partial<VaultContextProps> = {}) {
  const value = {
    account: 'spend',
    boardingAddress: 'tb1pboardingdestination',
    busy: false,
    clearSendScan: vi.fn(),
    dailyRemaining: 100_000,
    error: '',
    navigate: vi.fn(),
    reviewSpend: vi.fn(),
    scanOnSend: false,
    setSpendDraft: vi.fn(),
    spend: { address: '', amount: 0, fee: 0 },
    setup: { dailyLimitSats: 100_000, txCapSats: 50_000 },
    status: { network: 'mutinynet' },
    positions: {
      spending: { availableSats: 80_000, pendingSats: 0, totalSats: 80_000 },
      savings: { availableSats: 0, pendingSats: 0, totalSats: 0 },
    },
    ...overrides,
  } as unknown as VaultContextProps
  render(
    <ToastProvider>
      <VaultContext.Provider value={value}>
        <VaultSend />
      </VaultContext.Provider>
    </ToastProvider>,
  )
  return value
}

describe('Vault send scanner origin', () => {
  it('returns Home when the Home camera is cancelled', () => {
    const value = renderSend({
      scanOnSend: true,
      spend: { address: 'tark1previousattempt', amount: 12_000, fee: 0 },
    })
    expect(screen.getByRole('heading', { name: 'Scan payment' })).toBeTruthy()
    expect(screen.queryByDisplayValue('tark1previousattempt')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(value.clearSendScan).toHaveBeenCalled()
    expect(value.navigate).toHaveBeenCalledWith('home')
    expect(screen.queryByRole('heading', { name: 'Send' })).toBeNull()
  })

  it('stays on Send when the in-form camera is cancelled', () => {
    const value = renderSend({ spend: { address: '', amount: 0, fee: 0 } })
    fireEvent.click(screen.getByRole('button', { name: 'Scan destination' }))
    expect(screen.getByRole('heading', { name: 'Scan payment' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(value.navigate).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Send' })).toBeTruthy()
    expect(screen.getByLabelText('To')).toHaveValue('')
  })

  it('does not keep a previous destination in the To field', () => {
    renderSend({ spend: { address: '', amount: 0, fee: 0 } })
    expect(screen.getByLabelText('To')).toHaveValue('')
  })

  it('offers Send anyway when an exact in-progress send can be replaced', () => {
    const value = renderSend({
      canReplaceInFlightSend: true,
      error: 'A send of this exact amount to this address is still in progress.',
      replaceInFlightSend: vi.fn(),
      spend: { address: 'tark1same', amount: 20_000, fee: 0 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send anyway' }))
    expect(value.replaceInFlightSend).toHaveBeenCalled()
  })
})

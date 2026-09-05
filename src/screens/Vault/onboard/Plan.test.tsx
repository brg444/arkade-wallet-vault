import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VaultContext, type VaultContextProps } from '../../../vault/context'
import VaultPlan from './Plan'
import VaultReady from './Ready'

function renderOnboard(screenName: 'plan' | 'ready', overrides: Partial<VaultContextProps> = {}) {
  const value = {
    finishPlan: vi.fn(),
    navigate: vi.fn(),
    networkLabel: 'Bitcoin',
    setup: {
      protectionTier: 'standard',
      hardwarePub: '02'.repeat(33),
      recoveryPub: '',
      txCapSats: 50_000,
      dailyLimitSats: 100_000,
    },
    ...overrides,
  } as unknown as VaultContextProps
  render(
    <VaultContext.Provider value={value}>
      {screenName === 'plan' ? <VaultPlan /> : <VaultReady />}
    </VaultContext.Provider>,
  )
}

describe('onboarding network labels', () => {
  it('shows the live mainnet network on the plan and ready screens', () => {
    renderOnboard('plan', { networkLabel: 'Bitcoin' })
    expect(screen.getByText('Bitcoin')).toBeTruthy()
    expect(screen.queryByText('Mutinynet')).toBeNull()
  })

  it('does not hardcode Mutinynet after a mainnet enrollment', () => {
    renderOnboard('ready', { networkLabel: 'Bitcoin' })
    expect(screen.getByText(/on Bitcoin/)).toBeTruthy()
    expect(screen.queryByText(/Mutinynet/)).toBeNull()
  })
})

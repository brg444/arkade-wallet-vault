import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ToastProvider } from '../../components/Toast'
import { buildVaultProgramDescriptor } from '../../lib/vault/program/descriptor'
import { PROGRAM_FIXTURE } from '../../lib/vault/program/fixtures'
import { buildRecoveryKit } from '../../lib/vault/program/kit'
import { VaultContext, type VaultContextProps } from '../../vault/context'
import VaultRecover from './Recover'
import type { InitiateAlert } from '../../lib/vault/program/watch'
import type { FamilyKey } from '../../lib/vault/program/constants'

const kit = buildRecoveryKit(buildVaultProgramDescriptor(PROGRAM_FIXTURE))
const dest = kit.descriptor.savings.address

function alert(familyKey: FamilyKey): InitiateAlert {
  return {
    familyKey,
    address: kit.descriptor.pending[familyKey].address,
    txid: 'dd'.repeat(32),
    vout: 0,
    value: 20_000,
    seenAt: '2026-08-19T00:00:00.000Z',
  }
}

function renderLost(familyKey: FamilyKey, extra: Partial<VaultContextProps> = {}) {
  const value = {
    downloadRecoveryKit: () => JSON.stringify(kit),
    backupRecoveryKit: async () => false,
    restoreRecoveryKit: async () => {},
    signGuardianExitWithDevice: async (psbt) => psbt,
    hasRecoveryKit: true,
    initiateAlert: 'Someone started recovery',
    initiateAlerts: [alert(familyKey)],
    busy: false,
    error: '',
    navigate: () => {},
    openRecover: () => {},
    recoverEntry: 'lost',
    recoverExit: 'keys',
    savingsAddress: kit.descriptor.savings.address,
    ...extra,
  } as VaultContextProps
  return render(
    <ToastProvider>
      <VaultContext.Provider value={value}>
        <VaultRecover />
      </VaultContext.Provider>
    </ToastProvider>,
  )
}

function startCancel(familyKey: FamilyKey) {
  renderLost(familyKey)
  fireEvent.change(screen.getByTestId('recover-claim-dest'), { target: { value: dest } })
  fireEvent.click(screen.getByTestId('recover-guardian-exit'))
}

describe('claimant-aware cancel without services', () => {
  it('asks hardware and recovery after this device starts recovery', { timeout: 15_000 }, () => {
    startCancel('savings-phone')
    expect(screen.getByTestId('recover-guardian-signers').textContent).toMatch(/Hardware and Recovery/)
    expect(screen.queryByTestId('recover-guardian-device')).toBeNull()
    expect(screen.getByTestId('recover-guardian-external').textContent).toMatch(/Hardware/)
    expect(screen.getByTestId('recover-guardian-signers').textContent).not.toMatch(/This device/)
  })

  it('asks this device and recovery after hardware starts recovery', () => {
    startCancel('savings-hardware')
    expect(screen.getByTestId('recover-guardian-signers').textContent).toMatch(/This device and Recovery/)
    expect(screen.getByTestId('recover-guardian-device')).toBeTruthy()
    expect(screen.getByTestId('recover-guardian-external').textContent).toMatch(/Recovery/)
  })

  it('asks this device and hardware after recovery starts recovery', () => {
    startCancel('savings-recovery')
    expect(screen.getByTestId('recover-guardian-signers').textContent).toMatch(/This device and Hardware/)
    expect(screen.getByTestId('recover-guardian-device')).toBeTruthy()
    expect(screen.getByTestId('recover-guardian-external').textContent).toMatch(/Hardware/)
  })
})

import { ArkAddress } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ENROLL_STORE, SELECTED_VAULT_STORE } from '../lib/vault/enrollmentStore'
import type { VaultStatus } from '../lib/vault/types'
import golden from '../lib/vault/vtxo/testdata/vault-policy-v1-tree.json'
import { VtxoReviewedReservationError, type VaultVtxoSpendQuote } from '../lib/vault/vtxo/spend'
import { VaultContext, VaultProvider } from './vault'

const mocks = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  reserve: vi.fn(),
  send: vi.fn(),
}))

vi.mock('../lib/vault/status', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/vault/status')>()
  return {
    ...original,
    fetchPublicStatus: vi.fn(),
    fetchVaultStatus: mocks.fetchStatus,
  }
})

vi.mock('../lib/vault/vtxo/spend', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/vault/vtxo/spend')>()
  return {
    ...original,
    reserveVaultVtxo: mocks.reserve,
    sendVaultVtxo: mocks.send,
  }
})

vi.mock('../vault/useVaultBalances', () => ({
  useVaultBalances: () => ({
    balanceError: '',
    balancesLoaded: true,
    boardingInProgress: false,
    history: [],
    refreshBalance: vi.fn().mockResolvedValue(undefined),
    refreshingBalance: false,
    savingsSats: 0,
    vtxoSpendingSats: 20_000,
  }),
}))

vi.mock('../vault/useVaultSession', () => ({
  useVaultSession: () => ({
    enableOtherDevices: vi.fn().mockResolvedValue(undefined),
    enroll: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('../vault/useRecoveryKit', () => ({
  useRecoveryKit: () => ({
    backupRecoveryKit: vi.fn().mockResolvedValue(false),
    downloadRecoveryKit: vi.fn().mockReturnValue(''),
    hasRecoveryKit: false,
    initiateAlert: '',
    initiateAlerts: [],
    restoreRecoveryKit: vi.fn().mockResolvedValue(undefined),
    signGuardianExitWithDevice: vi.fn().mockResolvedValue(''),
  }),
}))

const destination = new ArkAddress(
  hex.decode(golden.fixtures.arkdServerPub),
  hex.decode(golden.fixtures.exitHardwarePub),
  'tark',
).encode()

const status: VaultStatus = {
  enrolled: true,
  network: 'mutinynet',
  vaultId: 'vault-a',
  periodAllowance: 100_000,
  periodSpent: 0,
  periodRemaining: 100_000,
  txCap: 50_000,
  absoluteFeeCap: 1_500,
  feerateCapSatVb: 10,
  spendingArkAddress: destination,
}

const reviewed: VaultVtxoSpendQuote = {
  operationId: '11'.repeat(16),
  bundleDigest: '22'.repeat(32),
  destAddress: destination,
  amountSats: 12_000,
  feeSats: 500,
  feePolicyDigest: '33'.repeat(32),
  reservationExpires: '2099-08-20T00:02:00Z',
  changeSats: 7_500,
  changeVout: 1,
}

function Probe() {
  const vault = useContext(VaultContext)
  return (
    <div>
      <span data-testid='screen'>{vault.screen}</span>
      <span data-testid='ready'>{String(Boolean(vault.status?.enrolled))}</span>
      <span data-testid='fee'>{vault.spend.fee}</span>
      <span data-testid='error'>{vault.error}</span>
      <button type='button' onClick={() => vault.setSpendDraft({ address: destination, amount: 12_000 })}>
        Set draft
      </button>
      <button type='button' onClick={vault.reviewSpend}>
        Review
      </button>
      <button type='button' onClick={vault.approveSend}>
        Approve
      </button>
    </div>
  )
}

describe('VaultProvider reviewed VTXO reservation', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(SELECTED_VAULT_STORE, 'vault-a')
    localStorage.setItem(
      `${ENROLL_STORE}:vault-a`,
      JSON.stringify({
        vaultId: 'vault-a',
        credId: '00',
        webauthnP256: '02',
        phoneDirectP256: '02',
        phoneBip340Pub: '02',
        nonce: '00',
        ciphertext: '00',
      }),
    )
    mocks.fetchStatus.mockResolvedValue(status)
    mocks.reserve.mockResolvedValue(reviewed)
    mocks.send.mockRejectedValue(new VtxoReviewedReservationError())
  })

  it('clears a stale review and returns to Send without reporting success', async () => {
    render(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Set draft' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Review' })))
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('review'))
    expect(screen.getByTestId('fee')).toHaveTextContent('500')

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })))
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('send'))
    expect(screen.getByTestId('fee')).toHaveTextContent('0')
    expect(screen.getByTestId('error')).toHaveTextContent('This fee quote expired or changed. Review the send again.')
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(expect.any(Object), status, reviewed)
  })
})

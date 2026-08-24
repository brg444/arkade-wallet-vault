import { ArkAddress } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POLICY_VERSION } from '../lib/vault/constants'
import { ENROLL_STORE, SELECTED_VAULT_STORE } from '../lib/vault/enrollmentStore'
import { MUTINYNET_INVOICE } from '../lib/vault/lightningTestUtils'
import { SAVINGS_TEMPLATE } from '../lib/vault/program/constants'
import type { VaultStatus } from '../lib/vault/types'
import golden from '../lib/vault/vtxo/testdata/vault-policy-v1-tree.json'
import { VtxoReviewedReservationError, type VaultVtxoSpendQuote } from '../lib/vault/vtxo/spend'
import { VaultContext, VaultProvider } from './vault'

const mocks = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  reserve: vi.fn(),
  send: vi.fn(),
  unlock: vi.fn(),
  requestLightning: vi.fn(),
  beginLightningFunding: vi.fn(),
  recordLightningFunding: vi.fn(),
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

vi.mock('../lib/vault/savingsSpend', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/vault/savingsSpend')>()
  return { ...original, unlockPhoneBip340: mocks.unlock }
})

vi.mock('../lib/vault/lightning', () => ({
  assertVaultLightningQuoteCurrent: vi.fn(),
  beginVaultLightningFunding: mocks.beginLightningFunding,
  recordVaultLightningFundingTxid: mocks.recordLightningFunding,
  requestVaultLightningQuote: mocks.requestLightning,
  withVaultLightningRepository: vi.fn(async (_vaultId, run) => run({})),
  withVaultLightningSdkWallet: vi.fn(async (_secret, _status, _origin, run) => run({})),
  withVaultLightningTransport: vi.fn(async (_profile, run) => run({})),
}))

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
  clientOrigin: 'https://vault.test',
  rpId: 'vault.test',
  vaultId: 'vault-a',
  templateVersion: SAVINGS_TEMPLATE,
  policyVersion: POLICY_VERSION,
  savingsAddress: '',
  savingsScript: '',
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
      <span data-testid='kind'>{vault.lastTxKind}</span>
      <button type='button' onClick={() => vault.setSpendDraft({ address: destination, amount: 12_000 })}>
        Set draft
      </button>
      <button type='button' onClick={vault.reviewSpend}>
        Review
      </button>
      <button type='button' onClick={() => vault.setSpendDraft({ address: MUTINYNET_INVOICE, amount: 2_100 })}>
        Set Lightning draft
      </button>
      <button type='button' onClick={vault.approveSend}>
        Approve
      </button>
    </div>
  )
}

describe('VaultProvider reviewed VTXO reservation', () => {
  afterEach(() => vi.unstubAllEnvs())

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
    mocks.unlock.mockResolvedValue(new Uint8Array(32).fill(7))
    mocks.beginLightningFunding.mockResolvedValue({
      rfqId: '44'.repeat(32),
      address: destination,
      amountSats: 2_125,
    })
    mocks.recordLightningFunding.mockResolvedValue(undefined)
    mocks.requestLightning.mockResolvedValue({
      kind: 'lightning',
      invoice: MUTINYNET_INVOICE,
      invoiceAmountSats: 2_100,
      invoiceExpiresAt: 4_000_000_000,
      rfqId: '44'.repeat(32),
      fundAddress: destination,
      fundAmountSats: 2_125,
      corridorFeeSats: 25,
      validUntil: 4_000_000_000,
      refundLocktime: 4_000_000_100,
    })
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

  it('does not open Home when a stored enrollment has no pinned Vault Program', async () => {
    render(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('signin'))
  })

  it('quotes and funds Lightning through the ordinary reviewed VTXO send', async () => {
    vi.stubEnv('VITE_VAULT_LIGHTNING_SEND', 'true')
    const lightningFunding = { ...reviewed, destAddress: destination, amountSats: 2_125, feeSats: 50 }
    mocks.reserve.mockResolvedValue(lightningFunding)
    mocks.send.mockResolvedValue({ txid: '55'.repeat(32), feeSats: 50 })

    render(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Set Lightning draft' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Review' })))
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('review'))
    expect(screen.getByTestId('fee')).toHaveTextContent('75')
    expect(mocks.reserve).toHaveBeenCalledWith(expect.any(Object), status, destination, 2_125)

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })))
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('success'))
    expect(screen.getByTestId('kind')).toHaveTextContent('lightning')
    expect(mocks.beginLightningFunding).toHaveBeenCalledWith(expect.any(Object), '44'.repeat(32))
    expect(mocks.recordLightningFunding).toHaveBeenCalledWith(expect.any(Object), '44'.repeat(32), '55'.repeat(32))
    expect(mocks.send).toHaveBeenCalledWith(expect.any(Object), status, lightningFunding)
  })
})

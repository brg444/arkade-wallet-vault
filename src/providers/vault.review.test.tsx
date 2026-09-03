import { ArkAddress } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POLICY_VERSION } from '../lib/vault/constants'
import { ENROLL_STORE, SELECTED_VAULT_STORE, SESSION_LOCK_STORE } from '../lib/vault/enrollmentStore'
import { MUTINYNET_INVOICE, MUTINYNET_INVOICE_TIMESTAMP } from '../lib/vault/lightningTestUtils'
import { SAVINGS_TEMPLATE } from '../lib/vault/program/constants'
import { SETUP_STORE_KEY } from '../lib/vault/setupPlan'
import type { VaultStatus } from '../lib/vault/types'
import golden from '../lib/vault/vtxo/testdata/vault-policy-v1-tree.json'
import { VtxoReviewedReservationError, type VaultVtxoSpendQuote } from '../lib/vault/vtxo/spend'
import { VaultContext, VaultProvider } from './vault'

const mocks = vi.hoisted(() => ({
  FundingNotStartedError: class FundingNotStartedError extends Error {},
  fetchStatus: vi.fn(),
  reserve: vi.fn(),
  send: vi.fn(),
  sdkWallet: vi.fn(),
  unlock: vi.fn(),
  requestLightning: vi.fn(),
  beginLightningFunding: vi.fn(),
  resumeLightningFunding: vi.fn(),
  recordLightningFunding: vi.fn(),
  getLightningStatus: vi.fn(),
  loadHandoff: vi.fn(),
  lightningEnabled: vi.fn(),
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
    previewVaultVtxoSend: async (_status: unknown, destAddress: string, amountSats: number) => ({
      destAddress,
      amountSats,
      feeSats: 0,
    }),
    newVtxoSpendChallenge: () => 'aa'.repeat(32),
    createVtxoSpendUnlocker: () => ({
      unlock: async () => ({
        assertion: { credentialId: 'aa', clientDataJSON: 'bb', authenticatorData: 'cc', signature: 'dd' },
        phoneSecret: new Uint8Array(32).fill(7),
        scalar: new Uint8Array(32).fill(8),
      }),
      dispose: () => undefined,
    }),
  }
})

vi.mock('../lib/vault/savingsSpend', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/vault/savingsSpend')>()
  return { ...original, unlockPhoneBip340: mocks.unlock }
})

vi.mock('../lib/vault/savingsHandoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/vault/savingsHandoff')>()),
  loadPendingSavingsHandoff: mocks.loadHandoff,
}))

vi.mock('../lib/vault/lightning', () => ({
  VaultLightningFundingNotStartedError: mocks.FundingNotStartedError,
  assertVaultLightningQuoteCurrent: vi.fn(),
  beginVaultLightningFunding: mocks.beginLightningFunding,
  resumeVaultLightningFunding: mocks.resumeLightningFunding,
  recordVaultLightningFundingTxid: mocks.recordLightningFunding,
  getVaultLightningStatus: mocks.getLightningStatus,
  requestVaultLightningQuote: mocks.requestLightning,
  withVaultLightningRepository: vi.fn(async (_vaultId, run) => run({})),
  withVaultLightningLifecycleLock: vi.fn(async (_vaultId, run) => run()),
  withVaultLightningSdkWallet: mocks.sdkWallet,
  withVaultLightningTransport: vi.fn(async (_profile, run) => run({})),
}))

vi.mock('../lib/vault/lightningConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/vault/lightningConfig')>()),
  vaultLightningSendEnabled: mocks.lightningEnabled,
}))

vi.mock('../vault/useVaultBalances', () => ({
  useVaultBalances: () => ({
    balanceError: '',
    balancesLoaded: true,
    history: [],
    positions: {
      spending: { availableSats: 20_000, pendingSats: 0, totalSats: 20_000 },
      savings: { availableSats: 0, pendingSats: 0, totalSats: 0 },
    },
    refreshBalance: vi.fn().mockResolvedValue(undefined),
    refreshingBalance: false,
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
  protectionTier: 'standard',
  savingsAddress: '',
  savingsScript: '',
  periodAllowance: 100_000,
  periodSpent: 0,
  periodRemaining: 100_000,
  txCap: 50_000,
  absoluteFeeCap: 5_000,
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
      <span data-testid='destination'>{vault.spend.address}</span>
      <span data-testid='error'>{vault.error}</span>
      <span data-testid='kind'>{vault.lastTxKind}</span>
      <span data-testid='activity'>{vault.history[0]?.activity || ''}</span>
      <button type='button' onClick={() => vault.setSpendDraft({ address: destination, amount: 12_000 })}>
        Set draft
      </button>
      <button type='button' onClick={() => vault.navigate('home')}>
        Go home
      </button>
      <button type='button' onClick={() => vault.openSendScan()}>
        Open scan
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
      <button type='button' onClick={() => vault.setAccount('savings')}>
        Show Savings
      </button>
      <button type='button' onClick={() => vault.history[0] && vault.openTx(vault.history[0])}>
        Open first activity
      </button>
      <button type='button' onClick={() => vault.retryLightningRefund('44'.repeat(32))}>
        Return Lightning
      </button>
    </div>
  )
}

describe('VaultProvider reviewed VTXO reservation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

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
    mocks.loadHandoff.mockReturnValue(null)
    mocks.lightningEnabled.mockReturnValue(false)
    mocks.reserve.mockResolvedValue(reviewed)
    mocks.send.mockRejectedValue(new VtxoReviewedReservationError())
    mocks.sdkWallet.mockImplementation(async (_secret, _status, run) => run({ repository: {} }))
    mocks.unlock.mockResolvedValue(new Uint8Array(32).fill(7))
    mocks.beginLightningFunding.mockResolvedValue({
      rfqId: '44'.repeat(32),
      address: destination,
      amountSats: 2_125,
    })
    mocks.resumeLightningFunding.mockRejectedValue(new mocks.FundingNotStartedError('not started'))
    mocks.recordLightningFunding.mockResolvedValue(undefined)
    mocks.getLightningStatus.mockResolvedValue({ state: 'refunded' })
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

  it('forgets a previous send destination when returning home or opening the Home camera', async () => {
    render(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Set draft' }))
    expect(screen.getByTestId('destination')).toHaveTextContent(destination)

    fireEvent.click(screen.getByRole('button', { name: 'Go home' }))
    expect(screen.getByTestId('screen')).toHaveTextContent('home')
    expect(screen.getByTestId('destination')).toHaveTextContent('')

    fireEvent.click(screen.getByRole('button', { name: 'Set draft' }))
    expect(screen.getByTestId('destination')).toHaveTextContent(destination)
    fireEvent.click(screen.getByRole('button', { name: 'Open scan' }))
    expect(screen.getByTestId('screen')).toHaveTextContent('send')
    expect(screen.getByTestId('destination')).toHaveTextContent('')
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
    expect(screen.getByTestId('fee')).toHaveTextContent('0')

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })))
    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('send'))
    expect(screen.getByTestId('fee')).toHaveTextContent('0')
    expect(screen.getByTestId('error')).toHaveTextContent('This fee quote expired or changed. Review the send again.')
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(expect.any(Object), status, reviewed, expect.any(Function))
  })

  it('does not open Home when a stored enrollment has no pinned Vault Program', async () => {
    render(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('signin'))
  })

  it('returns a locked enrolled vault to Unlock instead of the completed setup screen', async () => {
    localStorage.setItem(SESSION_LOCK_STORE, '1')
    localStorage.setItem(
      SETUP_STORE_KEY,
      JSON.stringify({
        hardwarePub: '',
        recoveryPub: '',
        txCapSats: 50_000,
        dailyLimitSats: 100_000,
        acceptedDesign: true,
        complete: true,
      }),
    )

    render(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('welcome'))
  })

  it('locks an enrolled vault behind passkey when privacy lock is on', async () => {
    localStorage.setItem('arkade-vault-privacy-lock', '1')

    render(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('screen')).toHaveTextContent('unlock'))
  })

  it('quotes and funds Lightning through the ordinary reviewed VTXO send', async () => {
    mocks.lightningEnabled.mockReturnValue(true)
    vi.spyOn(Date, 'now').mockReturnValue((MUTINYNET_INVOICE_TIMESTAMP + 1) * 1_000)
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
    expect(mocks.beginLightningFunding).toHaveBeenCalledWith(
      expect.any(Object),
      '44'.repeat(32),
      expect.objectContaining({
        rfqId: '44'.repeat(32),
        address: destination,
        amountSats: 2_125,
        operationId: lightningFunding.operationId,
        bundleDigest: lightningFunding.bundleDigest,
        fundingFeeSats: 50,
      }),
    )
    expect(mocks.recordLightningFunding).toHaveBeenCalledWith(expect.any(Object), '44'.repeat(32), '55'.repeat(32))
    expect(mocks.send).toHaveBeenCalledWith(expect.any(Object), status, lightningFunding)
    expect(mocks.sdkWallet.mock.calls[0]?.[3]).toBeUndefined()
  })

  it('restores a pending Savings handoff and reopens its hardware step', async () => {
    mocks.loadHandoff.mockReturnValue({
      version: 1,
      vaultId: 'vault-a',
      psbtHex: 'phone-signed-psbt',
      destAddress: destination,
      amountSats: 12_000,
      feeSats: 1_500,
      network: 'mutinynet',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    })

    render(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    fireEvent.click(screen.getByRole('button', { name: 'Show Savings' }))
    await waitFor(() => expect(screen.getByTestId('activity')).toHaveTextContent('savings-handoff'))
    fireEvent.click(screen.getByRole('button', { name: 'Open first activity' }))
    expect(screen.getByTestId('screen')).toHaveTextContent('handoff')
    expect(screen.getByTestId('fee')).toHaveTextContent('1500')
  })

  it('reacquires and clears the phone key for a package-managed refund retry', async () => {
    vi.stubEnv('VITE_VAULT_LIGHTNING_SEND', 'true')
    const phoneSecret = new Uint8Array(32).fill(7)
    mocks.unlock.mockResolvedValueOnce(phoneSecret)

    render(
      <VaultProvider>
        <Probe />
      </VaultProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Return Lightning' })))

    expect(mocks.getLightningStatus).toHaveBeenCalledWith(expect.any(Object), '44'.repeat(32))
    expect(mocks.sdkWallet.mock.calls.at(-1)?.[3]).toEqual({ refundRfqId: '44'.repeat(32) })
    expect(phoneSecret).toEqual(new Uint8Array(32))
    expect(screen.getByTestId('error')).toHaveTextContent('')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { vaultCosignerClient } from '../cosignerClient'
import type { BoardingDescriptor } from '../types'
import { createBoardingSigningAdapter } from './boardingAdapter'
import { waitForVaultSettlementStream } from './settlementEventSource'

vi.mock('../cosignerClient', () => ({
  vaultCosignerClient: {
    boarding: {
      prepare: vi.fn(),
      register: vi.fn(),
      release: vi.fn(),
      final: vi.fn(),
    },
  },
}))

vi.mock('./settlementEventSource', () => ({
  waitForVaultSettlementStream: vi.fn().mockResolvedValue(undefined),
}))

const DESCRIPTOR = {
  vaultBoardCosignerPub: `02${'11'.repeat(32)}`,
} as BoardingDescriptor

describe('vault-board-v1 SDK adapter', () => {
  it('passes every prepare outcome through without taking over lifecycle state', async () => {
    const adapter = createBoardingSigningAdapter('vault-a', DESCRIPTOR)
    const request = {
      inputs: [{ txid: 'aa'.repeat(32), vout: 1 }],
      recipients: [{ address: 'tark1spending', amount: 20_000 }],
    }
    for (const outcome of [
      { status: 'ready', handle: 'ready-handle', registerExpireAt: 10 },
      { status: 'release_required', handle: 'release-handle', deleteExpireAt: 11 },
      { status: 'blocked', reason: 'ambiguous' },
      { status: 'finalized', commitmentTxid: 'bb'.repeat(32) },
    ] as const) {
      vi.mocked(vaultCosignerClient.boarding.prepare).mockResolvedValueOnce(outcome)
      await expect(adapter.prepareRegistration(request)).resolves.toEqual(outcome)
    }
    expect(vaultCosignerClient.boarding.prepare).toHaveBeenCalledWith({
      vaultId: 'vault-a',
      inputs: [{ txid: 'aa'.repeat(32), vout: 1 }],
      recipients: [{ address: 'tark1spending', amountSats: 20_000 }],
    })
  })

  it('binds the exact register and release messages to the server handle', async () => {
    const adapter = createBoardingSigningAdapter('vault-a', DESCRIPTOR)
    const txid = 'aa'.repeat(32)
    vi.mocked(vaultCosignerClient.boarding.prepare).mockResolvedValue({
      status: 'ready',
      handle: 'register-handle',
      registerExpireAt: 10,
    })
    vi.mocked(vaultCosignerClient.boarding.register).mockResolvedValue({ status: 'registered', intentId: 'intent' })
    vi.mocked(vaultCosignerClient.boarding.release).mockResolvedValue({ status: 'released' })

    await adapter.prepareRegistration({
      inputs: [{ txid, vout: 1 }],
      recipients: [{ address: 'tark1spending', amount: 20_000 }],
    })
    await adapter.registerIntent({
      handle: 'register-handle',
      psbt: 'register-psbt',
      inputIndexes: [0],
      message: {
        type: 'register',
        onchain_output_indexes: [0],
        valid_at: 1,
        expire_at: 2,
        cosigners_public_keys: ['cosigner'],
      },
    })
    await adapter.releaseIntent({
      handle: 'release-handle',
      psbt: 'release-psbt',
      inputIndexes: [0],
      message: { type: 'delete', expire_at: 3 },
    })

    expect(vaultCosignerClient.boarding.register).toHaveBeenCalledWith({
      handle: 'register-handle',
      psbt: 'register-psbt',
      inputIndexes: [0],
      message: {
        type: 'register',
        onchain_output_indexes: [0],
        valid_at: 1,
        expire_at: 2,
        cosigners_public_keys: ['cosigner'],
      },
    })
    expect(waitForVaultSettlementStream).toHaveBeenCalledWith(`${txid}:1`)
    expect(vaultCosignerClient.boarding.release).toHaveBeenCalledWith({
      handle: 'release-handle',
      psbt: 'release-psbt',
      inputIndexes: [0],
      message: { type: 'delete', expire_at: 3 },
    })
  })

  it('does not register before an open stream is bound to the prepared outpoint', async () => {
    const adapter = createBoardingSigningAdapter('vault-a', DESCRIPTOR)
    await expect(
      adapter.registerIntent({
        handle: 'unprepared',
        psbt: 'register-psbt',
        inputIndexes: [0],
        message: {
          type: 'register',
          onchain_output_indexes: [0],
          valid_at: 1,
          expire_at: 2,
          cosigners_public_keys: ['cosigner'],
        },
      }),
    ).rejects.toThrow(/not bound to the prepared outpoint/)
    expect(vaultCosignerClient.boarding.register).not.toHaveBeenCalled()
  })

  it('holds the server registration until the prepared settlement stream is ready', async () => {
    const adapter = createBoardingSigningAdapter('vault-a', DESCRIPTOR)
    const txid = 'bb'.repeat(32)
    vi.mocked(vaultCosignerClient.boarding.prepare).mockResolvedValue({
      status: 'ready',
      handle: 'ready-handle',
      registerExpireAt: 10,
    })
    let open!: () => void
    vi.mocked(waitForVaultSettlementStream).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        open = resolve
      }),
    )
    vi.mocked(vaultCosignerClient.boarding.register).mockResolvedValue({ status: 'registered', intentId: 'intent' })
    await adapter.prepareRegistration({
      inputs: [{ txid, vout: 0 }],
      recipients: [{ address: 'tark1spending', amount: 20_000 }],
    })

    const registration = adapter.registerIntent({
      handle: 'ready-handle',
      psbt: 'register-psbt',
      inputIndexes: [0],
      message: {
        type: 'register',
        onchain_output_indexes: [0],
        valid_at: 1,
        expire_at: 2,
        cosigners_public_keys: ['cosigner'],
      },
    })
    await Promise.resolve()
    expect(vaultCosignerClient.boarding.register).not.toHaveBeenCalled()

    open()
    await expect(registration).resolves.toEqual({ status: 'registered', intentId: 'intent' })
  })

  it('forwards only SDK-validated final evidence, including batch expiry', async () => {
    const adapter = createBoardingSigningAdapter('vault-a', DESCRIPTOR)
    vi.mocked(vaultCosignerClient.boarding.final).mockResolvedValue({ status: 'submitted' })
    await adapter.submitCommitment({
      handle: 'final-handle',
      psbt: 'commitment-psbt',
      inputIndexes: [0],
      signedForfeits: ['forfeit'],
      validatedBatch: {
        batchId: 'batch',
        batchExpiry: 604_672n,
        unsignedCommitmentTx: 'unsigned-commitment',
        vtxoTree: [{ txid: 'cc'.repeat(32), tx: 'tree-tx', children: { 0: 'dd'.repeat(32) } }],
        expectedRecipients: [{ address: 'tark1spending', amount: 20_000 }],
      },
    })

    expect(vaultCosignerClient.boarding.final).toHaveBeenCalledWith({
      handle: 'final-handle',
      psbt: 'commitment-psbt',
      inputIndexes: [0],
      signedForfeits: ['forfeit'],
      validatedBatch: {
        batchId: 'batch',
        batchExpiry: 604_672,
        unsignedCommitmentTx: 'unsigned-commitment',
        vtxoTree: [{ txid: 'cc'.repeat(32), tx: 'tree-tx', children: { 0: 'dd'.repeat(32) } }],
        expectedRecipients: [{ address: 'tark1spending', amountSats: 20_000 }],
      },
    })
  })

  it('rejects expanded recipient or multi-input scope before calling the runtime', async () => {
    const adapter = createBoardingSigningAdapter('vault-a', DESCRIPTOR)
    await expect(
      adapter.prepareRegistration({
        inputs: [
          { txid: 'aa'.repeat(32), vout: 0 },
          { txid: 'bb'.repeat(32), vout: 0 },
        ],
        recipients: [{ address: 'tark1spending', amount: 20_000 }],
      }),
    ).rejects.toThrow(/one boarding input/)
    await expect(
      adapter.prepareRegistration({
        inputs: [{ txid: 'aa'.repeat(32), vout: 0 }],
        recipients: [{ address: 'tark1spending', amount: 20_000, assets: [{ assetId: 'asset', amount: 1n }] }],
      }),
    ).rejects.toThrow(/BTC-only/)
    expect(vaultCosignerClient.boarding.prepare).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { vaultCosignerClient } from '../cosignerClient'
import type { VaultBoardV2Descriptor } from '../types'
import { createVaultBoardV2SigningAdapter } from './boardV2Adapter'

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

const DESCRIPTOR = {
  vaultBoardCosignerPub: `02${'11'.repeat(32)}`,
} as VaultBoardV2Descriptor

describe('vault-board-v2 SDK adapter', () => {
  it('passes every prepare outcome through without taking over lifecycle state', async () => {
    const adapter = createVaultBoardV2SigningAdapter('vault-a', DESCRIPTOR)
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
    const adapter = createVaultBoardV2SigningAdapter('vault-a', DESCRIPTOR)
    vi.mocked(vaultCosignerClient.boarding.register).mockResolvedValue({ status: 'registered', intentId: 'intent' })
    vi.mocked(vaultCosignerClient.boarding.release).mockResolvedValue({ status: 'released' })

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
    expect(vaultCosignerClient.boarding.release).toHaveBeenCalledWith({
      handle: 'release-handle',
      psbt: 'release-psbt',
      inputIndexes: [0],
      message: { type: 'delete', expire_at: 3 },
    })
  })

  it('forwards only SDK-validated final evidence, including batch expiry', async () => {
    const adapter = createVaultBoardV2SigningAdapter('vault-a', DESCRIPTOR)
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
    const adapter = createVaultBoardV2SigningAdapter('vault-a', DESCRIPTOR)
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

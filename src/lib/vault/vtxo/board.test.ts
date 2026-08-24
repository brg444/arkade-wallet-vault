import { DefaultVtxo, SettlementEventType, SingleKey, type ExtendedCoin } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { describe, expect, it, vi } from 'vitest'
import { vaultAddressNetwork } from '../bitcoin'
import { SAVINGS_TEMPLATE } from '../program/constants'
import type { VaultStatus } from '../types'
import type { VaultLockManager } from './lock'
import {
  VAULT_BOARD_V1,
  VAULT_BOARD_V1_EXIT_DELAY,
  VAULT_BOARD_V1_EXIT_DELAY_UNIT,
  boardingAttemptKeyAfterLock,
  createTemporaryBoardingStorage,
  disposeVaultBoardingResources,
  findConfirmedBoardingCoins,
  isReleasedIntentRetry,
  nextVaultBoardingAction,
  settleBoardingWithReleasedIntentRetry,
  vaultBoardScriptFromStatus,
  waitForNextBatchFailure,
  withVaultBoardingLock,
} from './board'

function boardingCoin(txid: string, vout: number, value: number, confirmed = true): ExtendedCoin {
  return { txid, vout, value, status: { confirmed } } as ExtendedCoin
}

async function status(): Promise<{ current: VaultStatus; operatorPub: Uint8Array }> {
  const phone = SingleKey.fromPrivateKey(hex.decode('01'.padStart(64, '0')))
  const operator = SingleKey.fromPrivateKey(hex.decode('04'.padStart(64, '0')))
  const phonePub = await phone.compressedPublicKey()
  const operatorPub = (await operator.compressedPublicKey()).subarray(1)
  const script = new DefaultVtxo.Script({
    pubKey: phonePub.subarray(1),
    serverPubKey: operatorPub,
    csvTimelock: { type: VAULT_BOARD_V1_EXIT_DELAY_UNIT, value: VAULT_BOARD_V1_EXIT_DELAY },
  })
  return {
    operatorPub,
    current: {
      enrolled: true,
      network: 'mutinynet',
      clientOrigin: 'https://vault.test',
      rpId: 'vault.test',
      vaultId: 'vault-a',
      templateVersion: SAVINGS_TEMPLATE,
      policyVersion: 'vault-spending-policy-v1',
      savingsAddress: '',
      savingsScript: '5120' + '00'.repeat(32),
      periodAllowance: 100_000,
      periodSpent: 0,
      periodRemaining: 100_000,
      txCap: 50_000,
      absoluteFeeCap: 5_000,
      feerateCapSatVb: 10,
      phoneBip340Pub: hex.encode(phonePub),
      spendingArkAddress: 'tark1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
      vtxoBoardingActive: true,
      vtxoBoardingProgram: VAULT_BOARD_V1,
      vtxoBoardingAddress: script.onchainAddress(vaultAddressNetwork('mutinynet')),
      vtxoBoardingScript: hex.encode(script.pkScript),
      vtxoBoardingExitDelay: Number(VAULT_BOARD_V1_EXIT_DELAY),
      vtxoBoardingExitDelayUnit: VAULT_BOARD_V1_EXIT_DELAY_UNIT,
    },
  }
}

describe('vault-board-v1', () => {
  it('uses fresh in-memory SDK state for every temporary boarding wallet', async () => {
    const first = createTemporaryBoardingStorage()
    const second = createTemporaryBoardingStorage()
    await first.walletRepository.saveUtxos('boarding-address', [boardingCoin('11'.repeat(32), 0, 20_000)])

    await expect(first.walletRepository.getUtxos('boarding-address')).resolves.toHaveLength(1)
    await expect(second.walletRepository.getUtxos('boarding-address')).resolves.toEqual([])
  })

  it('disposes the wallet before both boarding repositories', async () => {
    const disposed: string[] = []
    const repository = (name: string) => ({
      async [Symbol.asyncDispose]() {
        disposed.push(name)
      },
    })
    const storage = {
      walletRepository: repository('wallet'),
      contractRepository: repository('contract'),
    }

    await disposeVaultBoardingResources(
      {
        async dispose() {
          disposed.push('sdk-wallet')
        },
      },
      storage,
    )
    expect(disposed[0]).toBe('sdk-wallet')
    expect(new Set(disposed.slice(1))).toEqual(new Set(['wallet', 'contract']))
  })

  it('closes every repository after partial wallet creation and after a disposal failure', async () => {
    const disposed: string[] = []
    const repository = (name: string, fail = false) => ({
      async [Symbol.asyncDispose]() {
        disposed.push(name)
        if (fail) throw new Error(`${name} close failed`)
      },
    })
    const storage = {
      walletRepository: repository('wallet', true),
      contractRepository: repository('contract'),
    }

    await expect(disposeVaultBoardingResources(undefined, storage)).rejects.toThrow(/wallet close failed/)
    expect(new Set(disposed)).toEqual(new Set(['wallet', 'contract']))
  })

  it('settles only deposits already sent to the boarding address', () => {
    expect(nextVaultBoardingAction({ confirmed: 0, total: 49_000 })).toBe('wait')
    expect(nextVaultBoardingAction({ confirmed: 49_000, total: 49_000 })).toBe('settle')
    expect(nextVaultBoardingAction({ confirmed: 0, total: 0 })).toBe('idle')
  })

  it('returns every confirmed boarding coin for the SDK settlement attempt', async () => {
    const first = boardingCoin('11'.repeat(32), 0, 20_000)
    const available = boardingCoin('22'.repeat(32), 1, 30_000)
    const unconfirmed = boardingCoin('33'.repeat(32), 2, 40_000, false)
    const wallet = { getBoardingUtxos: async () => [first, available, unconfirmed] }

    await expect(findConfirmedBoardingCoins(wallet)).resolves.toEqual([available, first])
  })

  it('can scope an SDK settlement retry to one boarding transaction', async () => {
    const first = boardingCoin('11'.repeat(32), 0, 20_000)
    const selected = boardingCoin('22'.repeat(32), 1, 30_000)
    const wallet = { getBoardingUtxos: async () => [first, selected] }

    await expect(findConfirmedBoardingCoins(wallet, selected.txid)).resolves.toEqual([selected])
  })

  it('waits for the exact outpoint lifecycle, then retries the exact SDK settlement once', async () => {
    const request = {
      inputs: [boardingCoin('11'.repeat(32), 0, 20_000)],
      outputs: [{ address: 'tark1destination', amount: 20_000n }],
    }
    const settle = async () => {
      if (calls++ === 0) throw new Error('INVALID_INTENT_PROOF (23): no matching intents found for intent proof')
      return 'commitment'
    }
    let calls = 0
    const provider = { getEventStream: vi.fn() }
    const waits: string[][] = []

    await expect(
      settleBoardingWithReleasedIntentRetry(
        { settle } as never,
        request,
        provider as never,
        async (_provider, topics) => {
          waits.push(topics)
        },
      ),
    ).resolves.toBe('commitment')
    expect(calls).toBe(2)
    expect(waits).toEqual([[`${'11'.repeat(32)}:0`]])
  })

  it('ignores batch start and releases only on batch failure, then closes the stream', async () => {
    let closed = false
    let signal: AbortSignal | undefined
    async function* events() {
      try {
        yield { type: SettlementEventType.BatchStarted } as never
        yield { type: SettlementEventType.BatchFailed, reason: 'not enough intent confirmations received' } as never
      } finally {
        closed = true
      }
    }
    const provider = {
      getEventStream(nextSignal: AbortSignal, topics: string[]) {
        signal = nextSignal
        expect(topics).toEqual([`${'11'.repeat(32)}:0`])
        return events()
      },
    }

    await waitForNextBatchFailure(provider as never, [`${'11'.repeat(32)}:0`])

    expect(closed).toBe(true)
    expect(signal?.aborted).toBe(true)
  })

  it('does not retry another SDK or Operator error', async () => {
    const settle = async () => {
      calls += 1
      throw new Error('not enough intent confirmations received')
    }
    let calls = 0
    const provider = { getEventStream: vi.fn() }

    await expect(
      settleBoardingWithReleasedIntentRetry({ settle } as never, { inputs: [], outputs: [] }, provider as never),
    ).rejects.toThrow(/not enough intent confirmations/)
    expect(calls).toBe(1)
    expect(provider.getEventStream).not.toHaveBeenCalled()
    expect(isReleasedIntentRetry(new Error('INVALID_INTENT_PROOF (23): no matching intents found'))).toBe(true)
  })

  it('reconstructs the distinct standard boarding contract pinned by status', async () => {
    const { current, operatorPub } = await status()
    const script = vaultBoardScriptFromStatus(current, operatorPub)
    expect(hex.encode(script.pkScript)).toBe(current.vtxoBoardingScript)
    expect(script.onchainAddress(vaultAddressNetwork('mutinynet'))).toBe(current.vtxoBoardingAddress)
    expect(current.vtxoBoardingScript).toBe('5120a077fad544f052d9730fb622fc1e737ef932eb7db907d2f1ee3792ce9e5d4d2c')
    expect(current.vtxoBoardingAddress).toBe('tb1p5pml442y7pfdjuc0kc30c8nn0mun96mahyra9u0wx7fva8jaf5kqavcsgc')
  })

  it('fails closed on a changed delay or script', async () => {
    const { current, operatorPub } = await status()
    expect(() => vaultBoardScriptFromStatus({ ...current, vtxoBoardingExitDelay: 604160 }, operatorPub)).toThrow(
      /exit delay/,
    )
    expect(() =>
      vaultBoardScriptFromStatus({ ...current, vtxoBoardingScript: `5120${'11'.repeat(32)}` }, operatorPub),
    ).toThrow(/script does not match/)
  })

  it('does not stick a boarding attempt when another tab already holds the lock', async () => {
    const busy: VaultLockManager = {
      request: async <T>(
        _name: string,
        _options: { mode: 'exclusive'; ifAvailable?: boolean },
        callback: (lock: unknown) => Promise<T>,
      ) => callback(null),
    }
    const result = await withVaultBoardingLock('vault-a', async () => 'settled', busy)
    expect(result).toEqual({ held: false })
    expect(boardingAttemptKeyAfterLock(result.held, 'vault-a:settle:49000:49000')).toBe('')
  })
})

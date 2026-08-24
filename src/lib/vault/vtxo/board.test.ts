import { DefaultVtxo, SingleKey, type ExtendedCoin } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { vaultAddressNetwork } from '../bitcoin'
import { SAVINGS_TEMPLATE } from '../program/constants'
import type { VaultStatus } from '../types'
import type { VaultLockManager } from './lock'
import {
  VAULT_BOARD_V1,
  VAULT_BOARD_V1_EXIT_DELAY,
  VAULT_BOARD_V1_EXIT_DELAY_UNIT,
  boardingAttemptKeyAfterLock,
  boardingFailureHold,
  classifyVaultBoardingOutpoint,
  disposeVaultBoardingResources,
  excludeSettledBoardingCoins,
  findConfirmedBoardingCoins,
  nextVaultBoardingAction,
  settledBoardingOutpoints,
  vaultBoardScriptFromStatus,
  withVaultBoardingLock,
  withVaultBoardingSecret,
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
      intentRepository: repository('intent'),
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
    expect(new Set(disposed.slice(1))).toEqual(new Set(['wallet', 'contract', 'intent']))
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
    expect(nextVaultBoardingAction({ settleableOutpoints: [], total: 49_000 })).toBe('wait')
    expect(nextVaultBoardingAction({ settleableOutpoints: ['11'.repeat(32) + ':0'], total: 49_000 })).toBe('settle')
    expect(nextVaultBoardingAction({ settleableOutpoints: [], total: 0 })).toBe('idle')
  })

  it('returns confirmed, non-expired boarding coins for SDK settlement', async () => {
    const first = boardingCoin('11'.repeat(32), 0, 20_000)
    const available = boardingCoin('22'.repeat(32), 1, 30_000)
    const unconfirmed = boardingCoin('33'.repeat(32), 2, 40_000, false)
    const expired = {
      ...boardingCoin('44'.repeat(32), 3, 50_000),
      status: {
        confirmed: true,
        block_time: Math.floor(Date.now() / 1_000) - Number(VAULT_BOARD_V1_EXIT_DELAY) - 1,
      },
    }
    const wallet = { getBoardingUtxos: async () => [first, available, unconfirmed, expired] }

    await expect(findConfirmedBoardingCoins(wallet)).resolves.toEqual([available, first])
  })

  it('scopes an SDK settlement attempt to one exact boarding outpoint', async () => {
    const first = boardingCoin('11'.repeat(32), 0, 20_000)
    const selected = boardingCoin('22'.repeat(32), 1, 30_000)
    const wallet = { getBoardingUtxos: async () => [first, selected] }

    await expect(findConfirmedBoardingCoins(wallet, `${selected.txid}:${selected.vout}`)).resolves.toEqual([selected])
  })

  it('keeps active and retained Operator intents blocked without a local timeout', () => {
    const outpoint = { txid: '11'.repeat(32), vout: 0 }
    const intent = (state: string, cancellationReason?: string) =>
      ({ state, cancellationReason, intentVtxos: [outpoint] }) as never

    expect(classifyVaultBoardingOutpoint([intent('waiting_to_submit')], outpoint)).toBe('blocked')
    expect(classifyVaultBoardingOutpoint([intent('waiting_for_batch')], outpoint)).toBe('blocked')
    expect(classifyVaultBoardingOutpoint([intent('batch_in_progress')], outpoint)).toBe('blocked')
    expect(
      classifyVaultBoardingOutpoint(
        [intent('cancelled', 'INVALID_INTENT_PROOF (23): no matching intents found')],
        outpoint,
      ),
    ).toBe('blocked')
  })

  it('keeps unrelated rows eligible but fails closed on every cancelled matching request', () => {
    const outpoint = { txid: '11'.repeat(32), vout: 0 }
    const other = { txid: '22'.repeat(32), vout: 0 }
    expect(
      classifyVaultBoardingOutpoint([{ state: 'waiting_for_batch', intentVtxos: [other] } as never], outpoint),
    ).toBe('eligible')
    expect(
      classifyVaultBoardingOutpoint(
        [{ state: 'cancelled', cancellationReason: 'validation failed', intentVtxos: [outpoint] } as never],
        outpoint,
      ),
    ).toBe('blocked')
  })

  it('lets settled destination evidence override stale local intent state', () => {
    const outpoint = { txid: '11'.repeat(32), vout: 0 }
    expect(
      classifyVaultBoardingOutpoint(
        [
          {
            state: 'waiting_for_batch',
            commitmentTransactionId: 'commitment',
            intentVtxos: [outpoint],
          } as never,
        ],
        outpoint,
        new Set(['commitment']),
      ),
    ).toBe('settled')
  })

  it('lets a succeeded destination VTXO suppress an Esplora-lagging boarding input', () => {
    const outpoint = { txid: '11'.repeat(32), vout: 0 }
    const settled = settledBoardingOutpoints([
      { state: 'waiting_for_batch', intentVtxos: [outpoint] },
      { state: 'batch_succeeded', intentVtxos: [outpoint] },
    ] as never)
    const laggingEsplora = [{ ...outpoint, value: 49_000 }]
    const visibleDestinationVtxos = 48_300

    expect(settled).toEqual(new Set([`${outpoint.txid}:0`]))
    expect(
      visibleDestinationVtxos +
        excludeSettledBoardingCoins(laggingEsplora, settled).reduce((sum, coin) => sum + coin.value, 0),
    ).toBe(visibleDestinationVtxos)
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

  it('keeps the signing scalar live until asynchronous settlement finishes, then wipes it', async () => {
    const secret = hex.decode('01'.padStart(64, '0'))
    let finish!: () => void
    const settlement = withVaultBoardingSecret(secret, async (liveSecret) => {
      expect(hex.encode(liveSecret)).toBe('01'.padStart(64, '0'))
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      expect(hex.encode(liveSecret)).toBe('01'.padStart(64, '0'))
      return 'settled'
    })

    await Promise.resolve()
    expect(hex.encode(secret)).toBe('01'.padStart(64, '0'))
    finish()
    await expect(settlement).resolves.toBe('settled')
    expect(hex.encode(secret)).toBe('00'.repeat(32))
  })

  it('keeps the SDK signing identity on the same wipeable scalar buffer', () => {
    const secret = hex.decode('01'.padStart(64, '0'))
    const identity = SingleKey.fromPrivateKey(secret)

    secret.fill(0)

    expect(identity.toHex()).toBe('00'.repeat(32))
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

  it('holds a cancelled passkey until the next focus instead of retrying immediately', () => {
    const key = 'vault-a:settle:49000:49000'
    expect(boardingFailureHold(new Error('The operation was aborted.'), key)).toEqual({
      attemptKey: key,
      retryDelayMs: 0,
    })
    expect(boardingFailureHold(new Error('INVALID_INTENT_PROOF (23): no matching intents found'), key)).toEqual({
      attemptKey: '',
      retryDelayMs: 5 * 60_000,
    })
  })
})

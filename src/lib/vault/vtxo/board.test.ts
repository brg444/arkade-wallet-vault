import { DefaultVtxo, SingleKey } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { vaultAddressNetwork } from '../bitcoin'
import type { VaultStatus } from '../types'
import {
  VAULT_BOARD_V1,
  VAULT_BOARD_V1_EXIT_DELAY,
  VAULT_BOARD_V1_EXIT_DELAY_UNIT,
  boardingAttemptKeyAfterLock,
  boardingRetryDelayMs,
  nextVaultBoardingAction,
  vaultBoardScriptFromStatus,
  withVaultBoardingLock,
  withVaultBoardingSecret,
} from './board'

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
      templateVersion: 'phone-hww-recovery-staged-v6',
      policyVersion: 'mandatory-change-tx50k-day100k-fee5k-feerate10-onchain-v3',
      operationalCsvBlocks: 144,
      savingsCsvBlocks: 6,
      operationalAddress: '',
      savingsAddress: '',
      savingsExcludesRoutineCosigners: true,
      periodAllowance: 100_000,
      periodSpent: 0,
      periodRemaining: 100_000,
      txCap: 50_000,
      absoluteFeeCap: 5_000,
      feerateCapSatVb: 10,
      phoneRoutineBip340Pub: hex.encode(phonePub),
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
  it('settles only deposits already sent to the boarding address', () => {
    expect(nextVaultBoardingAction({ confirmed: 0, total: 49_000 })).toBe('wait')
    expect(nextVaultBoardingAction({ confirmed: 49_000, total: 49_000 })).toBe('settle')
    expect(nextVaultBoardingAction({ confirmed: 0, total: 0 })).toBe('idle')
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

  it('does not stick a boarding attempt when another tab already holds the lock', async () => {
    const busy = {
      request: async (
        _name: string,
        _options: { mode: 'exclusive'; ifAvailable: boolean },
        callback: (lock: unknown) => Promise<unknown>,
      ) => callback(null),
    }
    const result = await withVaultBoardingLock('vault-a', async () => 'settled', busy)
    expect(result).toEqual({ held: false })
    expect(boardingAttemptKeyAfterLock(result.held, 'vault-a:settle:49000:49000')).toBe('')
  })

  it('does not impose the five-minute settle backoff after a cancelled passkey', () => {
    expect(boardingRetryDelayMs(new Error('The operation was aborted.'))).toBe(0)
    expect(boardingRetryDelayMs(new Error('INVALID_INTENT_PROOF (23): no matching intents found'))).toBe(5 * 60_000)
  })
})

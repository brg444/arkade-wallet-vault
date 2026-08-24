import type { VaultStatus } from '../types'
import { zeroBytes } from '../ceremony/directauth'
import { settleVaultBoarding, type VaultBoardingLock } from './board'

/**
 * Keeps the phone signer only for the current unlocked browser session and
 * exposes it solely to the pinned vault-board-v1 settlement operation.
 *
 * The caller retains a copy because every WebAuthn helper zeroes its own
 * working buffer. Nothing is persisted, and clear() is deterministic.
 */
export class VaultBoardingSignerSession {
  #secret: Uint8Array | undefined

  get ready(): boolean {
    return this.#secret?.length === 32
  }

  retain(secret: Uint8Array): void {
    if (secret.length !== 32) throw new Error('boarding signer must be 32 bytes')
    this.clear()
    this.#secret = secret.slice()
  }

  clear(): void {
    zeroBytes(this.#secret as Uint8Array)
    this.#secret = undefined
  }

  async settle(
    lock: VaultBoardingLock,
    status: VaultStatus,
    txid?: string,
  ): Promise<{ txid: string; amountSats: number }> {
    if (!this.#secret) throw new Error('Unlock the vault before boarding confirmed Bitcoin')
    const working = this.#secret.slice()
    try {
      return await settleVaultBoarding(lock, working, status, txid)
    } finally {
      zeroBytes(working)
    }
  }
}

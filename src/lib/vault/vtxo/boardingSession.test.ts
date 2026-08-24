import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VaultStatus } from '../types'
import { VaultBoardingSignerSession } from './boardingSession'

const mocks = vi.hoisted(() => ({ settle: vi.fn() }))

vi.mock('./board', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./board')>()),
  settleVaultBoarding: mocks.settle,
}))

afterEach(() => vi.clearAllMocks())

describe('VaultBoardingSignerSession', () => {
  it('retains a private copy and exposes it only to the pinned settlement call', async () => {
    const source = new Uint8Array(32).fill(7)
    const session = new VaultBoardingSignerSession()
    session.retain(source)
    source.fill(0)
    mocks.settle.mockImplementation(async (_lock, secret: Uint8Array) => {
      expect([...secret]).toEqual(new Array(32).fill(7))
      return { txid: '11'.repeat(32), amountSats: 10_000 }
    })

    const result = await session.settle({} as never, { vaultId: 'vault-a' } as VaultStatus)

    expect(result.amountSats).toBe(10_000)
    expect(session.ready).toBe(true)
  })

  it('fails closed after the session is cleared', async () => {
    const session = new VaultBoardingSignerSession()
    session.retain(new Uint8Array(32).fill(9))
    session.clear()

    await expect(session.settle({} as never, { vaultId: 'vault-a' } as VaultStatus)).rejects.toThrow(/Unlock/)
    expect(mocks.settle).not.toHaveBeenCalled()
  })
})

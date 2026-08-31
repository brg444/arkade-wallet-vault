import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddressPin } from '../lib/vault/pin'
import type { VaultSetupPlan } from '../lib/vault/setupPlan'
import type { EnrollmentSecrets } from '../lib/vault/tenantEnrollment'
import type { VaultStatus } from '../lib/vault/types'
import { useVaultSession } from './useVaultSession'

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  enable: vi.fn(),
  loadPin: vi.fn(),
  makePin: vi.fn(),
  pullMap: vi.fn(),
  recover: vi.fn(),
  savePin: vi.fn(),
  unlock: vi.fn(),
}))

vi.mock('../lib/vault/pin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/vault/pin')>()),
  loadAddressPin: mocks.loadPin,
  pinFromEnrolledStatus: mocks.makePin,
  saveAddressPin: mocks.savePin,
}))

vi.mock('../lib/vault/signIn', () => ({
  discoverVaultIdFromPasskey: mocks.discover,
  enablePasskeyLogin: mocks.enable,
  signInWithPasskey: mocks.recover,
  unlockLocalEnrollment: mocks.unlock,
}))

vi.mock('../lib/vault/program/kitBackup', () => ({
  kitFromFacts: vi.fn().mockReturnValue(null),
  pullMapBackup: mocks.pullMap,
  pushMapBackup: vi.fn(),
}))

vi.mock('../lib/vault/program/kitStore', () => ({ saveLocalKit: vi.fn() }))

const enrollment = {
  vaultId: 'vault-a',
  credId: '00',
  webauthnP256: '02',
  phoneDirectP256: '02',
  phoneBip340Pub: '02',
  nonce: '00',
  ciphertext: '00',
} as EnrollmentSecrets

const status = { enrolled: true, vaultId: 'vault-a' } as VaultStatus
const pin = { vaultId: 'vault-a', savingsAddress: 'tb1psavings' } as AddressPin
const setup = { hardwarePub: '', recoveryPub: '' } as VaultSetupPlan

function setupHook(
  session: { enrollment: EnrollmentSecrets | null; status: VaultStatus | null } = { enrollment, status },
) {
  const state = {
    reportError: vi.fn(),
    sealPlan: vi.fn(() => setup),
    setAddressPin: vi.fn(),
    setBusy: vi.fn(),
    setEnrollment: vi.fn(),
    setLocked: vi.fn(),
    setScreen: vi.fn(),
    setStatus: vi.fn(),
  }
  const hook = renderHook(() =>
    useVaultSession({
      enrollment: session.enrollment,
      ...state,
      setup,
      status: session.status,
    }),
  )
  return { ...hook, ...state }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocks.discover.mockResolvedValue('vault-a')
  mocks.enable.mockResolvedValue(status)
  mocks.pullMap.mockResolvedValue(null)
  mocks.recover.mockResolvedValue({ enrollment, status })
  mocks.makePin.mockReturnValue(pin)
  mocks.savePin.mockReturnValue(pin)
  mocks.unlock.mockResolvedValue({ enrollment, status })
})

describe('Vault session program-pin recovery', () => {
  it('upgrades and pins the signed passkey recovery binding when the local program pin is missing', async () => {
    mocks.loadPin.mockReturnValueOnce(null).mockReturnValueOnce(pin)
    const hook = setupHook()

    await act(async () => hook.result.current.signIn())

    expect(mocks.unlock).not.toHaveBeenCalled()
    expect(mocks.enable).toHaveBeenCalledExactlyOnceWith(enrollment)
    expect(mocks.recover).not.toHaveBeenCalled()
    expect(hook.setAddressPin).toHaveBeenCalledWith(pin)
    expect(hook.setScreen).toHaveBeenCalledWith('home')
  })

  it('keeps the local unlock path when the pinned Vault Program is present', async () => {
    mocks.loadPin.mockReturnValue(pin)
    const hook = setupHook()

    await act(async () => hook.result.current.signIn())

    expect(mocks.unlock).toHaveBeenCalledExactlyOnceWith(enrollment)
    expect(mocks.recover).not.toHaveBeenCalled()
    expect(hook.setStatus).toHaveBeenCalledWith(status)
    expect(hook.setScreen).toHaveBeenCalledWith('home')
  })

  it('opens Home without waiting for the optional recovery-map fetch', async () => {
    mocks.loadPin.mockReturnValue(pin)
    let releaseMap!: () => void
    mocks.pullMap.mockReturnValue(
      new Promise<null>((resolve) => {
        releaseMap = () => resolve(null)
      }),
    )
    const hook = setupHook()

    await act(async () => hook.result.current.signIn())

    expect(hook.setScreen).toHaveBeenCalledWith('home')
    releaseMap()
    await act(async () => Promise.resolve())
  })

  it('opens a genuinely fresh recovered session when private browsing rejects durable writes', async () => {
    mocks.loadPin.mockReturnValue(null)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })
    const hook = setupHook({ enrollment: null, status: null })

    await act(async () => hook.result.current.signIn())

    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith('vault-a')
    expect(hook.setEnrollment).toHaveBeenCalledWith(enrollment)
    expect(hook.setAddressPin).toHaveBeenCalledWith(pin)
    expect(hook.setStatus).toHaveBeenCalledWith(status)
    expect(hook.setLocked).toHaveBeenCalledWith(false)
    expect(hook.setScreen).toHaveBeenCalledWith('home')
    expect(hook.reportError).not.toHaveBeenCalledWith('Something went wrong. Try again.')

    setItem.mockRestore()
  })
})

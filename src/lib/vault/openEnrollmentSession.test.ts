import { afterEach, describe, expect, it, vi } from 'vitest'
import { vaultCosignerClient } from './cosignerClient'
import { clearOpenEnrollmentSession, openEnrollmentToken } from './openEnrollmentSession'

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('open enrollment admission', () => {
  it('reuses admission across a canceled prompt and discards it after completion', async () => {
    const issue = vi.spyOn(vaultCosignerClient.enrollment, 'session').mockResolvedValue({
      token: 'A'.repeat(43),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })
    expect(await openEnrollmentToken()).toBe('A'.repeat(43))
    expect(await openEnrollmentToken()).toBe('A'.repeat(43))
    expect(issue).toHaveBeenCalledTimes(1)
    clearOpenEnrollmentSession()
    await openEnrollmentToken()
    expect(issue).toHaveBeenCalledTimes(2)
  })

  it('replaces expired admission and rejects malformed or expired server responses', async () => {
    sessionStorage.setItem(
      'vaulted.open-enrollment-session',
      JSON.stringify({ token: 'A'.repeat(43), expiresAt: '2020-01-01' }),
    )
    const issue = vi
      .spyOn(vaultCosignerClient.enrollment, 'session')
      .mockResolvedValue({ token: 'bad', expiresAt: '2099-01-01' })
    await expect(openEnrollmentToken()).rejects.toThrow('could not be opened')
    issue.mockResolvedValue({ token: 'A'.repeat(43), expiresAt: '2020-01-01' })
    await expect(openEnrollmentToken()).rejects.toThrow('could not be opened')
    issue.mockResolvedValue({ token: 'B'.repeat(43), expiresAt: new Date(Date.now() + 600_000).toISOString() })
    expect(await openEnrollmentToken()).toBe('B'.repeat(43))
  })
})

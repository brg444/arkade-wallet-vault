import { describe, expect, it } from 'vitest'
import { humanizeVaultError } from './humanize'

describe('humanizeVaultError', () => {
  it('turns a network failure into a service message', () => {
    expect(humanizeVaultError(new Error('Failed to fetch'))).toMatch(/can’t reach|try again/i)
  })

  it('turns an empty proxy 500 into a service message', () => {
    expect(humanizeVaultError(new Error('Request failed (500)'))).toMatch(/can’t reach|try again/i)
    expect(humanizeVaultError(new Error('vault service is not running'))).toMatch(/can’t reach|try again/i)
  })

  it('explains a cancelled passkey', () => {
    expect(humanizeVaultError(new Error('The operation was aborted.'))).toMatch(/cancelled/i)
  })

  it('explains a missing recovery envelope', () => {
    expect(
      humanizeVaultError(new Error('passkey sign-in must first be enabled on the original enrolled device')),
    ).toMatch(/first browser|Enable sign-in/i)
  })

  it('explains an origin mismatch', () => {
    expect(humanizeVaultError(new Error('deployment origin does not match this signing client origin'))).toMatch(
      /wrong site/i,
    )
  })

  it('explains a swapped deposit address pin', () => {
    expect(humanizeVaultError(new Error('status deposit address does not match the local pin'))).toMatch(/do not send/i)
  })

  it('explains a leftover server proof requirement', () => {
    expect(humanizeVaultError(new Error('tenant enrollment requires owner and recovery signatures'))).toMatch(
      /no longer asks/i,
    )
  })

  it('explains a rejected Chrome passkey as a different credential store', () => {
    expect(humanizeVaultError(new Error('this passkey did not return its 32-byte PRF secret on this device'))).toMatch(
      /unlock secret|iPhone/i,
    )
    expect(humanizeVaultError(new Error('passkey authentication failed'))).toMatch(/scan the QR|original/i)
    expect(humanizeVaultError(new Error('this passkey does not belong to this vault'))).toMatch(/scan the QR|original/i)
  })
})

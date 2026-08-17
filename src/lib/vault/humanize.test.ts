import { describe, expect, it } from 'vitest'
import { humanizeVaultError } from './humanize'

describe('humanizeVaultError', () => {
  it('turns a network failure into a service message', () => {
    expect(humanizeVaultError(new Error('Failed to fetch'))).toMatch(/not running/i)
  })

  it('turns an empty proxy 500 into a service message', () => {
    expect(humanizeVaultError(new Error('Request failed (500)'))).toMatch(/not running/i)
    expect(humanizeVaultError(new Error('vault service is not running'))).toMatch(/not running/i)
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
      /different address/i,
    )
  })
})

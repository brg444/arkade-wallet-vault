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

  it('does not expose Operator intent internals during boarding', () => {
    expect(
      humanizeVaultError(new Error('INVALID_INTENT_PROOF (23): no matching intents found for intent proof')),
    ).toMatch(/Spending transfer.*processing/i)
    expect(humanizeVaultError(new Error('INTERNAL_ERROR (0): not enough intent confirmations received'))).toMatch(
      /Spending transfer.*processing/i,
    )
  })

  it('does not expose VTXO receipt internals after submission', () => {
    expect(humanizeVaultError(new Error('Reserved outpoint not spent by ark txid'))).toMatch(
      /send was submitted.*confirmed/i,
    )
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
    expect(humanizeVaultError(new Error('status deposit address does not match the local pin'))).toMatch(/don.t send/i)
  })

  it('explains a server that cannot enroll the staged program', () => {
    expect(humanizeVaultError(new Error('enroll needs a v5 vault'))).toMatch(/cannot add recovery yet/i)
  })

  it('explains a rejected Chrome passkey as a different credential store', () => {
    expect(humanizeVaultError(new Error('this passkey did not return its 32-byte PRF secret on this device'))).toMatch(
      /unlock secret|device that created/i,
    )
    expect(humanizeVaultError(new Error('passkey authentication failed'))).toMatch(/scan the QR|original/i)
    expect(humanizeVaultError(new Error('this passkey does not belong to this vault'))).toMatch(/scan the QR|original/i)
  })

  it('does not mislabel a vault script mismatch as a passkey failure', () => {
    expect(humanizeVaultError(new Error('savings tree does not match this vault’s address'))).toBe(
      'Savings tree does not match this vault’s address',
    )
  })
})

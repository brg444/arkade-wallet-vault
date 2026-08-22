import { describe, expect, it } from 'vitest'
import { humanizeVaultError, isRecoverableVaultBoardingError } from './humanize'

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
    ).toMatch(/Moving received Bitcoin.*approve Face ID/i)
    expect(humanizeVaultError(new Error('INTERNAL_ERROR (0): not enough intent confirmations received'))).toMatch(
      /Moving received Bitcoin.*approve Face ID/i,
    )
    expect(isRecoverableVaultBoardingError(new Error('EventSource error'))).toBe(true)
    expect(
      isRecoverableVaultBoardingError(new Error('duplicated input, 11:0 already registered by another intent')),
    ).toBe(true)
    expect(isRecoverableVaultBoardingError(new Error('Failed to fetch'))).toBe(false)
  })

  it('does not surface issuance-binding or mutated PhoneRoutine internals', () => {
    expect(humanizeVaultError(new Error('issuance aa is already bound to a different exact request'))).toMatch(
      /already in progress/i,
    )
    expect(humanizeVaultError(new Error('Authorized response mutated the PhoneRoutineBIP340 signature'))).toMatch(
      /rejected a changed signature/i,
    )
  })

  it('does not expose VTXO receipt internals after submission', () => {
    expect(humanizeVaultError(new Error('Reserved outpoint not spent by ark txid'))).toMatch(
      /send was submitted.*confirmed/i,
    )
    expect(humanizeVaultError(new Error('VTXO spend is unresolved'))).toMatch(/did not finish/i)
    expect(humanizeVaultError(new Error('VTXO reservation expired'))).toMatch(/did not finish/i)
  })

  it('does not expose signing scalar internals', () => {
    expect(humanizeVaultError(new Error('Invalid scalar: out of range'))).toBe(
      'Couldn’t unlock Spending. Sign in again.',
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

  it('explains a server that cannot enroll the current program', () => {
    expect(humanizeVaultError(new Error('enroll needs the current Vault Program descriptor'))).toMatch(
      /doesn.t match|update/i,
    )
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

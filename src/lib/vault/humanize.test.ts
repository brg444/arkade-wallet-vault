import { describe, expect, it } from 'vitest'
import { humanizeVaultError } from './humanize'

describe('humanizeVaultError', () => {
  it('turns a network failure into a service message', () => {
    expect(humanizeVaultError(new Error('Failed to fetch'))).toMatch(/cannot reach/i)
  })

  it('explains a cancelled passkey', () => {
    expect(humanizeVaultError(new Error('The operation was aborted.'))).toMatch(/cancelled/i)
  })

  it('explains an origin mismatch', () => {
    expect(humanizeVaultError(new Error('deployment origin does not match this signing client origin'))).toMatch(
      /different address/i,
    )
  })
})

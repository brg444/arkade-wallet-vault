import { describe, expect, it } from 'vitest'
import { configuredReleaseNetwork } from './releaseNetwork'

describe('release network binding', () => {
  it('defaults production builds to Mutinynet', () => {
    expect(configuredReleaseNetwork('', true)).toBe('mutinynet')
  })

  it('allows a deliberate mainnet build', () => {
    expect(configuredReleaseNetwork('mainnet', true)).toBe('mainnet')
  })

  it('rejects unsupported release networks', () => {
    expect(() => configuredReleaseNetwork('testnet', true)).toThrow(/unsupported Vault network/)
  })
})

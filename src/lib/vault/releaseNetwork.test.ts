import { describe, expect, it } from 'vitest'
import { configuredReleaseNetwork } from './releaseNetwork'

describe('release network binding', () => {
  it('requires an explicit network for production builds', () => {
    expect(() => configuredReleaseNetwork('', true)).toThrow(/Explicit Vault release network required/)
    expect(configuredReleaseNetwork('', false)).toBeUndefined()
    expect(configuredReleaseNetwork('mutinynet', true)).toBe('mutinynet')
  })

  it('allows a deliberate mainnet build', () => {
    expect(configuredReleaseNetwork('mainnet', true)).toBe('mainnet')
  })

  it('rejects unsupported release networks', () => {
    expect(() => configuredReleaseNetwork('testnet', true)).toThrow(/unsupported Vault network/)
  })
})

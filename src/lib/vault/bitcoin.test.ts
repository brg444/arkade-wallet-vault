import { describe, expect, it } from 'vitest'
import { isVaultBitcoinAddress, scriptHexFromAddress } from './bitcoin'

const TB1Q = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'

describe('vault bitcoin addresses', () => {
  it('decodes a checksummed testnet address and rejects mainnet, ark, and garbage', () => {
    expect(isVaultBitcoinAddress(TB1Q, 'mutinynet')).toBe(true)
    expect(isVaultBitcoinAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mutinynet')).toBe(false)
    expect(isVaultBitcoinAddress('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH', 'mutinynet')).toBe(false)
    expect(isVaultBitcoinAddress('tark1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toBe(
      false,
    )
    expect(isVaultBitcoinAddress('bcrt1p40xfaupmdqysq0c6m5m6q0c6m5m6q0c6m5m6q0c6m5m6q0c6m5mq7n0d2p')).toBe(false)
  })

  it('encodes a valid testnet address on mutinynet only', () => {
    const script = scriptHexFromAddress(TB1Q, 'mutinynet')
    expect(script.startsWith('0014')).toBe(true)
    expect(() => scriptHexFromAddress(TB1Q, 'regtest')).toThrow(/bitcoin address|unsupported/)
    expect(() => scriptHexFromAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mutinynet')).toThrow(
      /bitcoin address/,
    )
  })
})

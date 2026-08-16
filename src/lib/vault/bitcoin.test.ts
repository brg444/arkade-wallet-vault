import { describe, expect, it } from 'vitest'
import { isVaultBitcoinAddress, scriptHexFromAddress } from './bitcoin'

describe('vault bitcoin addresses', () => {
  it('accepts a bitcoin address and rejects an ark address', () => {
    expect(isVaultBitcoinAddress('bcrt1p40xfaupmdqysq0c6m5m6q0c6m5m6q0c6m5m6q0c6m5m6q0c6m5mq7n0d2p')).toBe(true)
    expect(isVaultBitcoinAddress('tark1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toBe(
      false,
    )
  })

  it('encodes a valid testnet address to a script', () => {
    const script = scriptHexFromAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mutinynet')
    expect(script.startsWith('0014')).toBe(true)
  })
})

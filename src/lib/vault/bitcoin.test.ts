import { ArkAddress } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { Address, NETWORK, TEST_NETWORK } from '@scure/btc-signer'
import { describe, expect, it } from 'vitest'
import {
  bitcoinDustSats,
  isVaultArkAddress,
  isVaultBitcoinAddress,
  isVaultSpendAddress,
  scriptHexFromAddress,
} from './bitcoin'

const TB1Q = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
const BC1Q = Address(NETWORK).encode(Address(TEST_NETWORK).decode(TB1Q))

describe('vault bitcoin addresses', () => {
  it('decodes a checksummed testnet address and rejects mainnet, ark, and garbage', () => {
    expect(isVaultBitcoinAddress(TB1Q, 'mutinynet')).toBe(true)
    expect(isVaultBitcoinAddress(BC1Q, 'mutinynet')).toBe(false)
    expect(isVaultBitcoinAddress('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH', 'mutinynet')).toBe(false)
    expect(isVaultBitcoinAddress('tark1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq')).toBe(
      false,
    )
    expect(isVaultBitcoinAddress('bcrt1p40xfaupmdqysq0c6m5m6q0c6m5m6q0c6m5m6q0c6m5m6q0c6m5mq7n0d2p')).toBe(false)
  })

  it('parses mainnet Bitcoin addresses only when the caller names bitcoin', () => {
    expect(isVaultBitcoinAddress(BC1Q, 'bitcoin')).toBe(true)
    expect(isVaultBitcoinAddress(TB1Q, 'bitcoin')).toBe(false)
    expect(scriptHexFromAddress(BC1Q, 'bitcoin').startsWith('0014')).toBe(true)
  })

  it('encodes a valid testnet address on mutinynet only', () => {
    const script = scriptHexFromAddress(TB1Q, 'mutinynet')
    expect(script.startsWith('0014')).toBe(true)
    expect(() => scriptHexFromAddress(TB1Q, 'regtest')).toThrow(/bitcoin address|unsupported/)
    expect(() => scriptHexFromAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mutinynet')).toThrow(
      /bitcoin address/,
    )
  })

  it('calculates the default relay dust threshold from the recipient script', () => {
    const p2pkh = Address(TEST_NETWORK).encode({ type: 'pkh', hash: new Uint8Array(20).fill(1) })
    const p2sh = Address(TEST_NETWORK).encode({ type: 'sh', hash: new Uint8Array(20).fill(2) })
    const p2wpkh = Address(TEST_NETWORK).encode({ type: 'wpkh', hash: new Uint8Array(20).fill(3) })
    const p2wsh = Address(TEST_NETWORK).encode({ type: 'wsh', hash: new Uint8Array(32).fill(4) })
    const p2tr = Address(TEST_NETWORK).encode({
      type: 'tr',
      pubkey: hex.decode('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
    })
    expect(bitcoinDustSats(p2pkh, 'mutinynet')).toBe(546)
    expect(bitcoinDustSats(p2sh, 'mutinynet')).toBe(540)
    expect(bitcoinDustSats(p2wpkh, 'mutinynet')).toBe(294)
    expect(bitcoinDustSats(p2wsh, 'mutinynet')).toBe(330)
    expect(bitcoinDustSats(p2tr, 'mutinynet')).toBe(330)
  })

  it('accepts only test-network Arkade addresses for the supported Vault networks', () => {
    const signer = hex.decode('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')
    const tapKey = hex.decode('c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5')
    const testAddress = new ArkAddress(signer, tapKey, 'tark').encode()
    const mainAddress = new ArkAddress(signer, tapKey, 'ark').encode()
    expect(isVaultArkAddress(testAddress, 'mutinynet')).toBe(true)
    expect(isVaultSpendAddress(testAddress, 'mutinynet')).toBe(true)
    expect(isVaultArkAddress(mainAddress, 'mutinynet')).toBe(false)
    expect(isVaultArkAddress(mainAddress, 'bitcoin')).toBe(true)
    expect(isVaultSpendAddress(mainAddress, 'bitcoin')).toBe(true)
    expect(isVaultArkAddress(testAddress, 'bitcoin')).toBe(false)
  })
})

import { hex } from '@scure/base'
import { Address, OutScript, TEST_NETWORK } from '@scure/btc-signer'
import { isBTCAddress } from '../address'

const REGTEST_NETWORK = {
  ...TEST_NETWORK,
  bech32: 'bcrt',
  bech32m: 'bcrt',
}

export function isVaultBitcoinAddress(value: string): boolean {
  return isBTCAddress(value.trim())
}

export function scriptHexFromAddress(address: string, network: string): string {
  const trimmed = address.trim()
  if (!isVaultBitcoinAddress(trimmed)) throw new Error('not a bitcoin address')
  const net = network === 'mutinynet' || trimmed.startsWith('tb1') ? TEST_NETWORK : REGTEST_NETWORK
  try {
    const decoded = Address(net).decode(trimmed)
    return hex.encode(OutScript.encode(decoded))
  } catch {
    throw new Error('not a bitcoin address')
  }
}

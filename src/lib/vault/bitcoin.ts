import { ArkAddress } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { Address, NETWORK, OutScript, TEST_NETWORK } from '@scure/btc-signer'

export function vaultAddressNetwork(network: string) {
  if (network === 'mutinynet') return TEST_NETWORK
  if (network === 'bitcoin' || network === 'mainnet') return NETWORK
  throw new Error('unsupported network')
}

export function isVaultBitcoinAddress(value: string, network?: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    const net = network
      ? vaultAddressNetwork(network)
      : trimmed.startsWith('tb1')
        ? TEST_NETWORK
        : trimmed.startsWith('bc1') || /^[13]/.test(trimmed)
          ? NETWORK
          : null
    if (!net) return false
    Address(net).decode(trimmed)
    return true
  } catch {
    return false
  }
}

export function isVaultSpendAddress(value: string, network?: string): boolean {
  return isVaultArkAddress(value, network) || isVaultBitcoinAddress(value, network)
}

export function isVaultArkAddress(value: string, network?: string): boolean {
  try {
    const decoded = ArkAddress.decode(value.trim())
    if (!network) return decoded.hrp === 'ark' || decoded.hrp === 'tark'
    return (
      decoded.hrp === (network === 'bitcoin' || network === 'mainnet' ? 'ark' : network === 'mutinynet' ? 'tark' : '')
    )
  } catch {
    return false
  }
}

export function scriptHexFromAddress(address: string, network: string): string {
  const trimmed = address.trim()
  try {
    const decoded = Address(vaultAddressNetwork(network)).decode(trimmed)
    return hex.encode(OutScript.encode(decoded))
  } catch {
    throw new Error('not a bitcoin address')
  }
}

import { NETWORK, TEST_NETWORK } from '@scure/btc-signer'

export function vaultAddressNetwork(network: string) {
  if (network === 'mutinynet') return TEST_NETWORK
  if (network === 'bitcoin' || network === 'mainnet') return NETWORK
  throw new Error('unsupported network')
}

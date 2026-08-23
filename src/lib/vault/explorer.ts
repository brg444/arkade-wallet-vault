export type VaultTransactionKind = 'arkade' | 'onchain'

export interface VaultTransactionExplorer {
  label: string
  url: string
}

const MUTINYNET_ARKADE_SPACE = 'https://explorer.mutinynet.arkade.sh'
const MUTINYNET_BITCOIN_EXPLORER = 'https://mempool.mutinynet.arkade.sh'
const MAINNET_ARKADE_SPACE = 'https://arkade.space'
const MAINNET_BITCOIN_EXPLORER = 'https://mempool.space'

export function vaultTransactionExplorer(
  txid: string,
  kind: VaultTransactionKind,
  network: string | undefined,
): VaultTransactionExplorer | null {
  const id = txid.trim()
  if (!id) return null
  const base =
    network === 'mutinynet'
      ? kind === 'arkade'
        ? MUTINYNET_ARKADE_SPACE
        : MUTINYNET_BITCOIN_EXPLORER
      : network === 'bitcoin'
        ? kind === 'arkade'
          ? MAINNET_ARKADE_SPACE
          : MAINNET_BITCOIN_EXPLORER
        : ''
  if (!base) return null
  return kind === 'arkade'
    ? { label: 'View on Arkade Space', url: `${base}/tx/${encodeURIComponent(id)}` }
    : { label: 'View on Bitcoin explorer', url: `${base}/tx/${encodeURIComponent(id)}` }
}

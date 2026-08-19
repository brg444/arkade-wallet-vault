import type { EsploraTx } from './esplora'

export type VaultHistoryKind = 'sent' | 'received'

export interface VaultHistoryItem {
  txid: string
  type: VaultHistoryKind
  amount: number
  confirmed: boolean
  blockTime?: number
  account: 'spend' | 'savings'
}

export function classifyAddressTx(tx: EsploraTx, address: string): Omit<VaultHistoryItem, 'account'> | null {
  if (!address) return null
  const spent = tx.vin.reduce(
    (sum, vin) => sum + (vin.prevout?.scriptpubkey_address === address ? Number(vin.prevout.value || 0) : 0),
    0,
  )
  const received = tx.vout.reduce(
    (sum, out) => sum + (out.scriptpubkey_address === address ? Number(out.value || 0) : 0),
    0,
  )
  if (spent === 0 && received === 0) return null
  const sent = spent > received
  const amount = sent ? spent - received : received - spent
  if (amount <= 0) return null
  return {
    txid: tx.txid,
    type: sent ? 'sent' : 'received',
    amount,
    confirmed: Boolean(tx.status.confirmed),
    blockTime: tx.status.block_time,
  }
}

export function historyFromTxs(txs: EsploraTx[], address: string, account: 'spend' | 'savings'): VaultHistoryItem[] {
  return txs
    .map((tx) => {
      const item = classifyAddressTx(tx, address)
      return item ? { ...item, account } : null
    })
    .filter((item): item is VaultHistoryItem => Boolean(item))
    .sort((a, b) => {
      if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1
      return (b.blockTime || 0) - (a.blockTime || 0)
    })
}

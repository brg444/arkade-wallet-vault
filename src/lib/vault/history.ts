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

export interface VaultHistoryGroup {
  key: string
  label: string
  items: VaultHistoryItem[]
}

/** Groups already-sorted history into the states and dates a wallet user needs to scan. */
export function groupVaultHistory(
  items: VaultHistoryItem[],
  nowSeconds = Math.floor(Date.now() / 1000),
): VaultHistoryGroup[] {
  const today = new Date(nowSeconds * 1000)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const groups: VaultHistoryGroup[] = []

  for (const item of items) {
    const group = historyGroup(item, today, yesterday)
    const previous = groups.at(-1)
    if (previous?.key === group.key) previous.items.push(item)
    else groups.push({ ...group, items: [item] })
  }
  return groups
}

function historyGroup(item: VaultHistoryItem, today: Date, yesterday: Date): Pick<VaultHistoryGroup, 'key' | 'label'> {
  if (!item.confirmed) return { key: 'pending', label: 'Pending' }
  if (!item.blockTime) return { key: 'earlier', label: 'Earlier' }
  const date = new Date(item.blockTime * 1000)
  const key = localDateKey(date)
  if (key === localDateKey(today)) return { key, label: 'Today' }
  if (key === localDateKey(yesterday)) return { key, label: 'Yesterday' }
  return {
    key,
    label: new Intl.DateTimeFormat('en', {
      day: 'numeric',
      month: 'long',
      ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    }).format(date),
  }
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
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
    .sort(sortVaultHistory)
}

export interface VaultVtxoHistoryCoin {
  txid: string
  value: number
  createdAtMs: number
  isSpent: boolean
  arkTxId?: string
  isLeaf?: boolean
}

/** Indexer VTXOs for the spending script: receives, sends, and change-aware net amounts. */
export function historyFromVtxos(
  coins: VaultVtxoHistoryCoin[],
  account: 'spend' | 'savings' = 'spend',
): VaultHistoryItem[] {
  const rows: VaultHistoryItem[] = []
  const spentByArk = new Set<string>()
  for (const coin of coins) {
    const createdAsChange = coins.some((other) => other.arkTxId && other.arkTxId === coin.txid)
    if (!createdAsChange && coin.value > 0) {
      rows.push({
        txid: coin.txid,
        type: 'received',
        amount: coin.value,
        confirmed: Boolean(coin.isLeaf),
        blockTime: unixSeconds(coin.createdAtMs),
        account,
      })
    }
    if (!coin.isSpent || !coin.arkTxId || spentByArk.has(coin.arkTxId)) continue
    spentByArk.add(coin.arkTxId)
    const spent = coins.filter((other) => other.arkTxId === coin.arkTxId)
    const change = coins.filter((other) => other.txid === coin.arkTxId)
    const amount =
      spent.reduce((sum, other) => sum + other.value, 0) - change.reduce((sum, other) => sum + other.value, 0)
    if (amount <= 0) continue
    rows.push({
      txid: coin.arkTxId,
      type: 'sent',
      amount,
      confirmed: true,
      blockTime: unixSeconds(change[0]?.createdAtMs || coin.createdAtMs + 1),
      account,
    })
  }
  return rows.sort(sortVaultHistory)
}

function unixSeconds(ms: number): number | undefined {
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  return Math.floor(ms / 1000)
}

function sortVaultHistory(a: VaultHistoryItem, b: VaultHistoryItem): number {
  if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1
  return (b.blockTime || 0) - (a.blockTime || 0)
}

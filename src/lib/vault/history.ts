import type { EsploraTx } from './esplora'
import { RECENT_HISTORY_LIMIT } from './constants'

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

export function recentAccountHistory(
  items: VaultHistoryItem[],
  account: VaultHistoryItem['account'],
  limit = RECENT_HISTORY_LIMIT,
): VaultHistoryItem[] {
  return items
    .filter((item) => item.account === account)
    .sort(sortVaultHistory)
    .slice(0, Math.max(0, limit))
}

/** Groups history into the states and dates a wallet user needs to scan. */
export function groupVaultHistory(
  items: VaultHistoryItem[],
  nowSeconds = Math.floor(Date.now() / 1000),
): VaultHistoryGroup[] {
  const today = new Date(nowSeconds * 1000)
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const groups: VaultHistoryGroup[] = []

  for (const item of [...items].sort(sortVaultHistory)) {
    const group = historyGroup(item, today, yesterday)
    const previous = groups.at(-1)
    if (previous?.key === group.key) previous.items.push(item)
    else groups.push({ ...group, items: [item] })
  }
  return groups
}

function historyGroup(item: VaultHistoryItem, today: Date, yesterday: Date): Pick<VaultHistoryGroup, 'key' | 'label'> {
  if (!item.confirmed) {
    return item.account === 'spend'
      ? { key: 'preconfirmed', label: 'Preconfirmed' }
      : { key: 'pending', label: 'Pending' }
  }
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
  const byTxid = new Map<string, VaultHistoryItem>()
  for (const tx of txs) {
    const item = classifyAddressTx(tx, address)
    if (!item) continue
    const next = { ...item, account }
    const previous = byTxid.get(item.txid)
    if (!previous || (!previous.confirmed && next.confirmed)) byTxid.set(item.txid, next)
  }
  return [...byTxid.values()].sort(sortVaultHistory)
}

export interface VaultVtxoHistoryCoin {
  txid: string
  vout: number
  value: number
  createdAtMs: number
  isSpent: boolean
  arkTxId?: string
  commitmentTxIds?: string[]
  isLeaf?: boolean
  settledBy?: string
}

/** Indexer VTXOs for the spending script: receives, sends, and change-aware net amounts. */
export function historyFromVtxos(
  coins: VaultVtxoHistoryCoin[],
  account: 'spend' | 'savings' = 'spend',
): VaultHistoryItem[] {
  const unique = uniqueHistoryCoins(coins)
  const rows: VaultHistoryItem[] = []
  const arkInputs = new Map<string, VaultVtxoHistoryCoin[]>()
  const outputs = new Map<string, VaultVtxoHistoryCoin[]>()
  const terminalArkInputs = new Map<string, VaultVtxoHistoryCoin>()
  const settledCommitments = new Set<string>()

  for (const coin of unique) {
    addHistoryCoin(outputs, coin.txid, coin)
    if (coin.arkTxId) {
      addHistoryCoin(arkInputs, coin.arkTxId, coin)
      if (coin.isSpent && !terminalArkInputs.has(coin.arkTxId)) terminalArkInputs.set(coin.arkTxId, coin)
    }
    if (coin.settledBy) settledCommitments.add(coin.settledBy)
  }

  for (const coin of unique) {
    const createdAsChange = arkInputs.has(coin.txid)
    const settlementCommitment = coin.isLeaf ? coin.commitmentTxIds?.[0] : undefined
    // Match the SDK history transition: a batch leaf that replaces VTXOs
    // forfeited into the same commitment settles the original receive; it is
    // not a second incoming payment.
    const settlementReplacement = Boolean(settlementCommitment && settledCommitments.has(settlementCommitment))
    if (!createdAsChange && !settlementReplacement && coin.value > 0) {
      rows.push({
        txid: coin.txid,
        type: 'received',
        amount: coin.value,
        // `isLeaf` is an indexer graph property, not a Bitcoin confirmation
        // flag. The SDK keeps a spent receive settled after its VTXO moves.
        confirmed: Boolean(coin.isLeaf || coin.isSpent),
        blockTime: unixSeconds(coin.createdAtMs),
        account,
      })
    }
  }

  for (const [arkTxId, terminalInput] of terminalArkInputs) {
    const spent = arkInputs.get(arkTxId) || []
    const change = outputs.get(arkTxId) || []
    const amount =
      spent.reduce((sum, other) => sum + other.value, 0) - change.reduce((sum, other) => sum + other.value, 0)
    if (amount <= 0) continue
    rows.push({
      txid: arkTxId,
      type: 'sent',
      amount,
      confirmed: true,
      blockTime: unixSeconds(change[0]?.createdAtMs || terminalInput.createdAtMs + 1),
      account,
    })
  }
  return mergeHistoryRows(rows).sort(sortVaultHistory)
}

function addHistoryCoin(index: Map<string, VaultVtxoHistoryCoin[]>, key: string, coin: VaultVtxoHistoryCoin): void {
  const current = index.get(key)
  if (current) current.push(coin)
  else index.set(key, [coin])
}

function uniqueHistoryCoins(coins: VaultVtxoHistoryCoin[]): VaultVtxoHistoryCoin[] {
  const byOutpoint = new Map<string, VaultVtxoHistoryCoin>()
  for (const coin of coins) {
    const key = `${coin.txid}:${coin.vout}`
    const previous = byOutpoint.get(key)
    byOutpoint.set(
      key,
      previous
        ? {
            ...previous,
            ...coin,
            arkTxId: coin.arkTxId || previous.arkTxId,
            commitmentTxIds: coin.commitmentTxIds?.length ? coin.commitmentTxIds : previous.commitmentTxIds,
            isLeaf: Boolean(previous.isLeaf || coin.isLeaf),
            isSpent: previous.isSpent || coin.isSpent,
            settledBy: coin.settledBy || previous.settledBy,
          }
        : coin,
    )
  }
  return [...byOutpoint.values()]
}

function mergeHistoryRows(rows: VaultHistoryItem[]): VaultHistoryItem[] {
  const merged = new Map<string, VaultHistoryItem>()
  for (const row of rows) {
    const key = `${row.account}:${row.txid}:${row.type}`
    const previous = merged.get(key)
    merged.set(
      key,
      previous
        ? {
            ...previous,
            amount: previous.amount + row.amount,
            blockTime: Math.max(previous.blockTime || 0, row.blockTime || 0) || undefined,
            confirmed: previous.confirmed && row.confirmed,
          }
        : row,
    )
  }
  return [...merged.values()]
}

function unixSeconds(ms: number): number | undefined {
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  return Math.floor(ms / 1000)
}

function sortVaultHistory(a: VaultHistoryItem, b: VaultHistoryItem): number {
  if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1
  return (
    (b.blockTime || 0) - (a.blockTime || 0) ||
    a.account.localeCompare(b.account) ||
    a.txid.localeCompare(b.txid) ||
    a.type.localeCompare(b.type) ||
    a.amount - b.amount
  )
}

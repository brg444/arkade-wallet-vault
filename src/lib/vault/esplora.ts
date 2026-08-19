import { readBounded } from './bounded'

export function esploraBase(): string {
  return '/esplora'
}

export interface EsploraUtxo {
  txid: string
  vout: number
  status: { confirmed: boolean; block_height?: number }
  value: number
}

async function esploraJson<T>(res: Response, fail: string): Promise<T> {
  const text = await readBounded(res)
  if (!res.ok) throw new Error(fail)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(fail)
  }
}

export interface EsploraTxio {
  scriptpubkey_address?: string
  value?: number
}

export interface EsploraTx {
  txid: string
  vin: { prevout?: EsploraTxio }[]
  vout: EsploraTxio[]
  status: { confirmed: boolean; block_height?: number; block_time?: number }
}

export async function fetchAddressTxs(address: string): Promise<EsploraTx[]> {
  const res = await fetch(`${esploraBase()}/address/${address}/txs`)
  return esploraJson<EsploraTx[]>(res, 'Could not load activity')
}

export async function fetchAddressUtxos(address: string): Promise<EsploraUtxo[]> {
  const res = await fetch(`${esploraBase()}/address/${address}/utxo`)
  return esploraJson<EsploraUtxo[]>(res, 'Could not load coins from Mutinynet')
}

export async function fetchTxHex(txid: string): Promise<string> {
  const res = await fetch(`${esploraBase()}/tx/${txid}/hex`)
  const text = await readBounded(res)
  if (!res.ok) throw new Error('Could not load the previous transaction')
  return text.trim()
}

export async function fetchAddressStats(address: string): Promise<{ funded: number; spent: number }> {
  const res = await fetch(`${esploraBase()}/address/${address}`)
  const body = await esploraJson<{ chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } }>(
    res,
    'Could not load the Mutinynet balance',
  )
  const chain = body.chain_stats || {}
  return {
    funded: Number(chain.funded_txo_sum || 0),
    spent: Number(chain.spent_txo_sum || 0),
  }
}

export function confirmedSpendable(utxos: EsploraUtxo[], need: number): EsploraUtxo | null {
  return utxos.filter((u) => u.status.confirmed && u.value >= need).sort((a, b) => a.value - b.value)[0] || null
}

export async function fetchTipHeight(): Promise<number> {
  const res = await fetch(`${esploraBase()}/blocks/tip/height`)
  const text = await readBounded(res)
  if (!res.ok) throw new Error('Could not load the chain tip')
  const height = Number(text.trim())
  if (!Number.isInteger(height) || height < 0) throw new Error('Could not load the chain tip')
  return height
}

export async function broadcastTx(txHex: string): Promise<string> {
  const res = await fetch(`${esploraBase()}/tx`, { method: 'POST', body: txHex })
  const text = await readBounded(res)
  if (!res.ok) throw new Error(text.trim() || 'Could not broadcast')
  return text.trim()
}

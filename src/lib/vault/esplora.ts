export function esploraBase(): string {
  return '/esplora'
}

export interface EsploraUtxo {
  txid: string
  vout: number
  status: { confirmed: boolean; block_height?: number }
  value: number
}

export async function fetchAddressUtxos(address: string): Promise<EsploraUtxo[]> {
  const res = await fetch(`${esploraBase()}/address/${address}/utxo`)
  if (!res.ok) throw new Error('Could not load coins from Mutinynet')
  return res.json()
}

export async function fetchTxHex(txid: string): Promise<string> {
  const res = await fetch(`${esploraBase()}/tx/${txid}/hex`)
  if (!res.ok) throw new Error('Could not load the previous transaction')
  return (await res.text()).trim()
}

export async function fetchAddressStats(address: string): Promise<{ funded: number; spent: number }> {
  const res = await fetch(`${esploraBase()}/address/${address}`)
  if (!res.ok) throw new Error('Could not load the Mutinynet balance')
  const body = await res.json()
  const chain = body.chain_stats || {}
  const mempool = body.mempool_stats || {}
  const funded = Number(chain.funded_txo_sum || 0) + Number(mempool.funded_txo_sum || 0)
  const spent = Number(chain.spent_txo_sum || 0) + Number(mempool.spent_txo_sum || 0)
  return { funded, spent }
}

export function confirmedSpendable(utxos: EsploraUtxo[], need: number): EsploraUtxo | null {
  return utxos.filter((u) => u.status.confirmed && u.value >= need).sort((a, b) => a.value - b.value)[0] || null
}

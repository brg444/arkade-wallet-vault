import { readBounded } from '../bounded'
import { P2A_SCRIPT_HEX } from './constants'
import type { ObservedSpend, PendingCoin, SessionView, SpendKind } from './session'

export type ChainFetch = (url: string) => Promise<Response>

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function readJson<T>(fetchImpl: ChainFetch, url: string, fail: string): Promise<T> {
  const res = await fetchImpl(url)
  const text = await readBounded(res)
  if (!res.ok) throw new Error(fail)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(fail)
  }
}

export function classifySpendDest(outputScriptHex: string, quarantineScriptHex: string): SpendKind {
  const out = outputScriptHex.trim().toLowerCase()
  const quarantine = quarantineScriptHex.trim().toLowerCase()
  if (out === quarantine) return 'quarantine'
  return 'other'
}

export function pickSpendOutput(outputs: { scriptpubkey?: string }[]): string | null {
  for (const out of outputs) {
    const script = String(out.scriptpubkey || '').toLowerCase()
    if (!script || script === P2A_SCRIPT_HEX || script.startsWith('6a')) continue
    return script
  }
  return null
}

interface EsploraUtxo {
  txid: string
  vout: number
  value: number
  status?: { confirmed?: boolean; block_height?: number }
}

interface EsploraOutspend {
  spent: boolean
  txid?: string
  status?: { confirmed?: boolean; block_height?: number }
}

interface EsploraTx {
  txid?: string
  vout?: { scriptpubkey?: string }[]
}

export async function loadSessionView(input: {
  base: string
  pendingAddress: string
  quarantineScriptHex: string
  outpoint?: { txid: string; vout: number }
  previouslyConfirmedHeight?: number
  requested?: boolean
  fetch?: ChainFetch
}): Promise<SessionView> {
  const fetchImpl = input.fetch || fetch
  const tipText = await (async () => {
    const res = await fetchImpl(joinUrl(input.base, 'blocks/tip/height'))
    const text = (await readBounded(res)).trim()
    if (!res.ok) throw new Error('Could not load the chain tip')
    const tip = Number(text)
    if (!Number.isInteger(tip) || tip < 0) throw new Error('Could not load the chain tip')
    return tip
  })()

  const utxos = await readJson<EsploraUtxo[]>(
    fetchImpl,
    joinUrl(input.base, `address/${input.pendingAddress}/utxo`),
    'Could not load pending coins',
  )
  const wanted = input.outpoint
  const match = wanted ? utxos.find((u) => u.txid === wanted.txid && u.vout === wanted.vout) : utxos[0]

  let pending: PendingCoin | undefined
  const spends: ObservedSpend[] = []

  if (match) {
    pending = {
      txid: match.txid,
      vout: match.vout,
      value: match.value,
      confirmed: !!match.status?.confirmed,
      blockHeight: match.status?.block_height,
    }
  } else if (wanted) {
    const spend = await readJson<EsploraOutspend>(
      fetchImpl,
      joinUrl(input.base, `tx/${wanted.txid}/outspend/${wanted.vout}`),
      'Could not load the pending outspend',
    )
    if (spend.spent && spend.txid) {
      const tx = await readJson<EsploraTx>(
        fetchImpl,
        joinUrl(input.base, `tx/${spend.txid}`),
        'Could not load the spending transaction',
      )
      const destScript = pickSpendOutput(tx.vout || [])
      spends.push({
        txid: spend.txid,
        confirmed: !!spend.status?.confirmed,
        dest: destScript ? classifySpendDest(destScript, input.quarantineScriptHex) : 'other',
      })
    }
  }

  return {
    tipHeight: tipText,
    pending,
    spends: spends.length ? spends : undefined,
    previouslyConfirmedHeight: input.previouslyConfirmedHeight,
    requested: input.requested,
  }
}

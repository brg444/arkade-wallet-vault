export const REPLAY_PURPOSES = ['initiate', 'clawback'] as const
export type ReplayPurpose = (typeof REPLAY_PURPOSES)[number]

export interface ReplayRequest {
  vaultId: string
  purpose: ReplayPurpose
  inputTxid: string
  inputVout: number
  destScriptHex: string
  sighash?: string
  signature?: string
}

export interface ReplayRecord {
  vaultId: string
  purpose: ReplayPurpose
  inputTxid: string
  inputVout: number
  destScriptHex: string
  lastSighash?: string
  signature?: string
}

export type ReplayAction = 'sign' | 'replay' | 'resign'

export interface ReplayDecision {
  action: ReplayAction
  record: ReplayRecord
}

export class ReplayRefuse extends Error {
  constructor(message = 'refusing a second dest or input set for this outpoint') {
    super(message)
    this.name = 'ReplayRefuse'
  }
}

export function outpointKey(txid: string, vout: number): string {
  const id = txid.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('txid must be 32-byte hex')
  if (!Number.isInteger(vout) || vout < 0) throw new Error('vout required')
  return `${id}:${vout}`
}

export function sessionKey(vaultId: string, txid: string, vout: number, purpose: ReplayPurpose): string {
  const id = vaultId.trim()
  if (!id) throw new Error('vault id required')
  if (!(REPLAY_PURPOSES as readonly string[]).includes(purpose)) throw new Error('purpose must be initiate or clawback')
  return `${id}/${outpointKey(txid, vout)}/${purpose}`
}

export interface ReplayStore {
  get(key: string): ReplayRecord | undefined
  put(record: ReplayRecord): void
}

export function memoryReplayStore(seed: ReplayRecord[] = []): ReplayStore {
  const map = new Map<string, ReplayRecord>()
  for (const row of seed) map.set(sessionKey(row.vaultId, row.inputTxid, row.inputVout, row.purpose), { ...row })
  return {
    get: (key) => {
      const row = map.get(key)
      return row ? { ...row } : undefined
    },
    put: (record) => {
      map.set(sessionKey(record.vaultId, record.inputTxid, record.inputVout, record.purpose), { ...record })
    },
  }
}

function requireRequest(req: ReplayRequest): ReplayRequest {
  if (!req.vaultId.trim()) throw new Error('vault id required')
  if (!(REPLAY_PURPOSES as readonly string[]).includes(req.purpose)) {
    throw new Error('purpose must be initiate or clawback')
  }
  const dest = req.destScriptHex.trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(dest) || dest.length < 4) throw new Error('dest script required')
  return {
    ...req,
    vaultId: req.vaultId.trim(),
    inputTxid: req.inputTxid.trim().toLowerCase(),
    destScriptHex: dest,
    sighash: req.sighash?.trim().toLowerCase(),
    signature: req.signature?.trim().toLowerCase(),
  }
}

export function decideReplay(existing: ReplayRecord | undefined, raw: ReplayRequest): ReplayDecision {
  const req = requireRequest(raw)
  const next: ReplayRecord = {
    vaultId: req.vaultId,
    purpose: req.purpose,
    inputTxid: req.inputTxid,
    inputVout: req.inputVout,
    destScriptHex: req.destScriptHex,
    lastSighash: req.sighash,
    signature: req.signature,
  }
  if (!existing) return { action: 'sign', record: next }
  if (existing.destScriptHex !== req.destScriptHex) throw new ReplayRefuse('second dest for this outpoint')
  if (existing.inputTxid !== req.inputTxid || existing.inputVout !== req.inputVout) {
    throw new ReplayRefuse('overlapping input set for this outpoint')
  }
  if (req.sighash && existing.lastSighash === req.sighash && existing.signature) {
    return { action: 'replay', record: existing }
  }
  return {
    action: 'resign',
    record: {
      ...existing,
      lastSighash: req.sighash || existing.lastSighash,
      signature: req.signature || existing.signature,
    },
  }
}

export function applyReplay(store: ReplayStore, req: ReplayRequest): ReplayDecision {
  const key = sessionKey(req.vaultId, req.inputTxid, req.inputVout, req.purpose)
  const decision = decideReplay(store.get(key), req)
  if (decision.action !== 'replay') store.put(decision.record)
  return decision
}

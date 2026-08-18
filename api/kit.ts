import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = '/tmp/arkade-vault-map'
const MAX_BYTES = 64 * 1024

function vaultIdFrom(req: { method?: string; url?: string; body?: unknown }): string {
  if (req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost')
    return String(url.searchParams.get('vault') || '').trim()
  }
  const body = req.body && typeof req.body === 'object' ? (req.body as { vaultId?: string }) : {}
  return String(body.vaultId || '').trim()
}

function isPublicMap(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const rec = raw as { name?: string; version?: number; kit?: { name?: string } }
  if (rec.name !== 'arkade-vault-map' || rec.version !== 1) return false
  if (rec.kit?.name !== 'arkade-recovery-kit') return false
  const text = JSON.stringify(raw)
  if (text.length > MAX_BYTES) return false
  const keys = JSON.stringify(Object.keys(rec)).toLowerCase()
  if (keys.includes('secret') || keys.includes('mnemonic') || keys.includes('seed')) return false
  return true
}

function readBody(req: { body?: unknown }): unknown {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }
  return req.body
}

export default function handler(
  req: { method?: string; url?: string; body?: unknown },
  res: {
    status: (code: number) => { json: (body: unknown) => void; end: () => void }
    json: (body: unknown) => void
  },
) {
  req = { ...req, body: readBody(req) }
  const vaultId = vaultIdFrom(req)
  if (!vaultId || vaultId.length > 128) {
    res.status(400).json({ error: 'vault id required' })
    return
  }
  const path = join(DIR, `${encodeURIComponent(vaultId)}.json`)
  try {
    mkdirSync(DIR, { recursive: true })
  } catch {
    // already exists
  }

  if (req.method === 'GET') {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      if (!isPublicMap(raw)) {
        res.status(404).json({ error: 'map not found' })
        return
      }
      res.status(200).json(raw)
    } catch {
      res.status(404).json({ error: 'map not found' })
    }
    return
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    if (!isPublicMap(req.body)) {
      res.status(400).json({ error: 'not a vault map backup' })
      return
    }
    writeFileSync(path, JSON.stringify(req.body))
    res.status(200).json({ ok: true, vaultId })
    return
  }

  res.status(405).json({ error: 'method not allowed' })
}

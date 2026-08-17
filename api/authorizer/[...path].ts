const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
])

export const MAX_GATEWAY_BYTES = 1024 * 1024
export const GATEWAY_UPSTREAM_TIMEOUT_MS = 20_000
const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 60

const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function authorizerOrigin(): string {
  return String(process.env.AUTHORIZER_ORIGIN || '').replace(/\/$/, '')
}

function gatewaySecret(): string {
  return String(process.env.AUTHORIZER_GATEWAY_SECRET || '').trim()
}

export function allowAuthorizerPath(path: string): boolean {
  return path === '/health' || path === '/v1' || path.startsWith('/v1/')
}

function requestHost(hostHeader: string | string[] | undefined): string {
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader
  return String(host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
}

// Browser CSRF filter only. Missing Origin/Sec-Fetch-Site is allowed so
// non-browser callers can use the public cryptographically authorized API.
// This is not caller authentication.
export function sameOriginAllowed(input: {
  host?: string | string[]
  origin?: string | string[]
  secFetchSite?: string | string[]
}): boolean {
  const site = String(Array.isArray(input.secFetchSite) ? input.secFetchSite[0] : input.secFetchSite || '')
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = String(Array.isArray(input.origin) ? input.origin[0] : input.origin || '').trim()
  if (!origin) return true
  try {
    return new URL(origin).host.toLowerCase() === requestHost(input.host)
  } catch {
    return false
  }
}

export function allowGatewayRate(key: string, now = Date.now()): boolean {
  const id = String(key || 'unknown')
  const bucket = rateBuckets.get(id)
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(id, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (bucket.count >= RATE_LIMIT) return false
  bucket.count += 1
  return true
}

export function clientAddress(headers: Record<string, string | string[] | undefined>): string {
  const forwarded = headers['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (first) return String(first).split(',')[0].trim()
  return String(headers['x-real-ip'] || 'unknown')
}

type VercelLikeReq = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query?: { path?: string | string[] }
  url?: string
  on(event: 'data', fn: (chunk: Buffer) => void): void
  on(event: 'end', fn: () => void): void
  on(event: 'error', fn: (err: Error) => void): void
}

type VercelLikeRes = {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string | Buffer): void
}

export function publicAuthorizerPath(url = ''): string {
  const q = url.includes('?') ? url.slice(url.indexOf('?')) : ''
  const raw = (url.split('?')[0] || '/').replace(/\/+$/, '') || '/'
  if (raw === '/api/health' || raw === '/health') return '/health' + q
  if (raw.startsWith('/api/authorizer/')) return raw.slice('/api/authorizer'.length) + q
  if (raw === '/api/authorizer') return '/' + q
  if (raw.startsWith('/api/v1')) return raw.slice('/api'.length) + q
  return raw + q
}

function targetPath(req: VercelLikeReq): string {
  if (req.url) return publicAuthorizerPath(req.url)
  const parts = req.query?.path
  const joined = Array.isArray(parts) ? parts.join('/') : String(parts || '')
  return '/' + joined.replace(/^\/+/, '')
}

function declaredLength(headers: Record<string, string | string[] | undefined>): number {
  const raw = headers['content-length']
  const value = Array.isArray(raw) ? raw[0] : raw
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

export function readBoundedRequest(req: VercelLikeReq, maxBytes = MAX_GATEWAY_BYTES): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return Promise.resolve(undefined)
  const declared = declaredLength(req.headers)
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.reject(new Error('API request too large'))
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.byteLength
      if (total > maxBytes) {
        reject(new Error('API request too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined))
    req.on('error', () => reject(new Error('gateway body')))
  })
}

export async function readBoundedUpstream(res: Response, maxBytes = MAX_GATEWAY_BYTES): Promise<Buffer> {
  const declared = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('API response too large')
  }
  if (!res.body?.getReader) {
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > maxBytes) throw new Error('API response too large')
    return buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('API response too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
}

function jsonError(res: VercelLikeRes, status: number, message: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: message }))
}

export default async function handler(req: VercelLikeReq, res: VercelLikeRes) {
  const origin = authorizerOrigin()
  if (!origin) {
    jsonError(res, 503, 'vault service is not running')
    return
  }
  const pathAndQuery = targetPath(req)
  const pathOnly = pathAndQuery.split('?')[0]
  if (!allowAuthorizerPath(pathOnly)) {
    res.statusCode = 404
    res.end()
    return
  }
  if (!sameOriginAllowed(req.headers)) {
    jsonError(res, 403, 'cross-origin authorizer access denied')
    return
  }
  if (pathOnly !== '/health' && !allowGatewayRate(clientAddress(req.headers))) {
    jsonError(res, 429, 'too many requests')
    return
  }

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || HOP_BY_HOP.has(key.toLowerCase())) continue
    headers[key] = Array.isArray(value) ? value.join(',') : value
  }
  const secret = gatewaySecret()
  if (secret) headers['x-vault-gateway-secret'] = secret

  let body: Buffer | undefined
  try {
    body = await readBoundedRequest(req)
  } catch {
    jsonError(res, 413, 'API request too large')
    return
  }
  const upstream = await fetch(origin + pathAndQuery, {
    method: req.method,
    headers,
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(GATEWAY_UPSTREAM_TIMEOUT_MS),
  })
  let payload: Buffer
  try {
    payload = await readBoundedUpstream(upstream)
  } catch {
    jsonError(res, 502, 'API response too large')
    return
  }
  res.statusCode = upstream.status
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value)
  })
  res.end(payload)
}

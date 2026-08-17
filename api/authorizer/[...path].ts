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

type VercelLikeReq = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query?: { path?: string | string[] }
  url?: string
  on(event: 'data', fn: (chunk: Buffer) => void): void
  on(event: 'end', fn: () => void): void
}

type VercelLikeRes = {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string | Buffer): void
}

function targetPath(req: VercelLikeReq): string {
  const parts = req.query?.path
  const joined = Array.isArray(parts) ? parts.join('/') : String(parts || '')
  const path = '/' + joined.replace(/^\/+/, '')
  const q = req.url && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
  return path + q
}

function readBody(req: VercelLikeReq): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined))
    req.on('error' as 'end', () => reject(new Error('gateway body')))
  })
}

export default async function handler(req: VercelLikeReq, res: VercelLikeRes) {
  const origin = authorizerOrigin()
  if (!origin) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'vault service is not running' }))
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
    res.statusCode = 403
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'cross-origin authorizer access denied' }))
    return
  }

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || HOP_BY_HOP.has(key.toLowerCase())) continue
    headers[key] = Array.isArray(value) ? value.join(',') : value
  }
  const secret = gatewaySecret()
  if (secret) headers['x-vault-gateway-secret'] = secret

  const body = await readBody(req)
  const upstream = await fetch(origin + pathAndQuery, {
    method: req.method,
    headers,
    body,
  })
  res.statusCode = upstream.status
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value)
  })
  res.end(Buffer.from(await upstream.arrayBuffer()))
}

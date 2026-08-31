import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import gatewayHandler, {
  allowAuthorizerPath,
  allowGatewayRate,
  MAX_GATEWAY_BYTES,
  publicAuthorizerPath,
  readBoundedUpstream,
  sameOriginAllowed,
} from '../../../api/authorizer/[...path]'

type GatewayRequest = Parameters<typeof gatewayHandler>[0]
type GatewayResponse = Parameters<typeof gatewayHandler>[1]

function gatewayRequest({
  body = '',
  headers = {},
  method = 'GET',
  url = '/api/v1/status',
}: {
  body?: string
  headers?: Record<string, string>
  method?: string
  url?: string
} = {}): GatewayRequest {
  const payload = Buffer.from(body)
  return {
    method,
    headers,
    url,
    on(event: 'data' | 'end' | 'error', callback: ((chunk: Buffer) => void) | (() => void)) {
      if (event === 'data' && payload.byteLength > 0) (callback as (chunk: Buffer) => void)(payload)
      if (event === 'end') (callback as () => void)()
    },
  } as GatewayRequest
}

function gatewayResponse() {
  let body: string | Buffer | undefined
  const headers = new Map<string, string>()
  const response: GatewayResponse = {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value)
    },
    end(value) {
      body = value
    },
  }
  return { response, headers, body: () => body }
}

function expectLocalNoStore(result: ReturnType<typeof gatewayResponse>) {
  expect(result.headers.get('cache-control')).toBe('no-store, max-age=0')
}

describe('same-origin authorizer gateway', () => {
  it('maps function URLs back to authorizer paths', () => {
    expect(publicAuthorizerPath('/api/health')).toBe('/health')
    expect(publicAuthorizerPath('/api/ready')).toBe('/ready')
    expect(publicAuthorizerPath('/api/v1/status')).toBe('/v1/status')
    expect(publicAuthorizerPath('/api/v1/status?vault=x')).toBe('/v1/status?vault=x')
    expect(publicAuthorizerPath('/api/v1/enroll/start')).toBe('/v1/enroll/start')
    expect(publicAuthorizerPath('/api/v1/passkey/challenge')).toBe('/v1/passkey/challenge')
    expect(publicAuthorizerPath('/api/authorizer/v1/enroll/start')).toBe('/v1/enroll/start')
    expect(publicAuthorizerPath('/api/v1/vtxo-operation?vaultId=x&operationId=y')).toBe(
      '/v1/vtxo/operation?vaultId=x&operationId=y',
    )
    expect(publicAuthorizerPath('/api/v1/vtxo-reserve')).toBe('/v1/vtxo/reserve')
    expect(publicAuthorizerPath('/api/v1/vtxo-authorize')).toBe('/v1/vtxo/authorize')
    expect(publicAuthorizerPath('/api/v1/vtxo-checkpoints-authorize')).toBe('/v1/vtxo/checkpoints/authorize')
    expect(publicAuthorizerPath('/api/v1/vtxo-finalize?operationId=x')).toBe('/v1/vtxo/finalize?operationId=x')
    expect(publicAuthorizerPath('/api/v1/vtxo-board-prepare')).toBe('/v1/vtxo/board/prepare')
    expect(publicAuthorizerPath('/api/v1/vtxo-board-register')).toBe('/v1/vtxo/board/register')
    expect(publicAuthorizerPath('/api/v1/vtxo-board-release')).toBe('/v1/vtxo/board/release')
    expect(publicAuthorizerPath('/api/v1/vtxo-board-final')).toBe('/v1/vtxo/board/final')
  })

  it('only proxies health, readiness, and /v1', () => {
    expect(allowAuthorizerPath('/health')).toBe(true)
    expect(allowAuthorizerPath('/ready')).toBe(true)
    expect(allowAuthorizerPath('/v1/status')).toBe(true)
    expect(allowAuthorizerPath('/v1/enroll/start')).toBe(true)
    expect(allowAuthorizerPath('/')).toBe(false)
    expect(allowAuthorizerPath('/api/authorizer/v1/status')).toBe(false)
  })

  it('treats Origin as a CSRF filter, not authentication', () => {
    expect(
      sameOriginAllowed({
        host: 'vault.example.com',
        origin: 'https://evil.example',
        secFetchSite: 'cross-site',
      }),
    ).toBe(false)
    expect(sameOriginAllowed({ host: 'vault.example.com' })).toBe(true)
    expect(
      sameOriginAllowed({
        host: 'vault.example.com',
        origin: 'https://vault.example.com',
        secFetchSite: 'same-origin',
      }),
    ).toBe(true)
  })

  it('rate-limits a noisy caller', () => {
    const key = 'rate-test-' + Math.random()
    for (let i = 0; i < 60; i++) expect(allowGatewayRate(key, 1)).toBe(true)
    expect(allowGatewayRate(key, 1)).toBe(false)
    expect(allowGatewayRate(key, 61_000)).toBe(true)
  })

  it('rejects an oversize upstream body', async () => {
    const res = new Response('x'.repeat(MAX_GATEWAY_BYTES + 1))
    await expect(readBoundedUpstream(res)).rejects.toThrow(/too large/)
  })
})

describe('gateway response cache policy', () => {
  beforeEach(() => {
    vi.stubEnv('AUTHORIZER_ORIGIN', 'https://authorizer.example')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('marks missing configuration and denied paths as no-store without changing their responses', async () => {
    vi.stubEnv('AUTHORIZER_ORIGIN', '')
    const missing = gatewayResponse()
    await gatewayHandler(gatewayRequest(), missing.response)
    expect(missing.response.statusCode).toBe(503)
    expect(missing.body()).toBe(JSON.stringify({ error: 'vault service is not running' }))
    expectLocalNoStore(missing)

    vi.stubEnv('AUTHORIZER_ORIGIN', 'https://authorizer.example')
    const denied = gatewayResponse()
    await gatewayHandler(gatewayRequest({ url: '/api/private' }), denied.response)
    expect(denied.response.statusCode).toBe(404)
    expect(denied.body()).toBeUndefined()
    expectLocalNoStore(denied)
  })

  it('marks same-origin and rate-limit denials as no-store', async () => {
    const crossOrigin = gatewayResponse()
    await gatewayHandler(
      gatewayRequest({ headers: { host: 'vault.example', origin: 'https://invalid.example' } }),
      crossOrigin.response,
    )
    expect(crossOrigin.response.statusCode).toBe(403)
    expect(crossOrigin.body()).toBe(JSON.stringify({ error: 'cross-origin authorizer access denied' }))
    expectLocalNoStore(crossOrigin)

    const caller = `rate-handler-${Math.random()}`
    const now = Date.now()
    for (let i = 0; i < 60; i++) expect(allowGatewayRate(caller, now)).toBe(true)
    const limited = gatewayResponse()
    await gatewayHandler(gatewayRequest({ headers: { 'x-forwarded-for': caller } }), limited.response)
    expect(limited.response.statusCode).toBe(429)
    expect(limited.body()).toBe(JSON.stringify({ error: 'too many requests' }))
    expectLocalNoStore(limited)
  })

  it('proxies readiness without consuming the browser API rate bucket', async () => {
    const caller = `ready-handler-${Math.random()}`
    const now = Date.now()
    for (let i = 0; i < 60; i++) expect(allowGatewayRate(caller, now)).toBe(true)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = gatewayResponse()
    await gatewayHandler(gatewayRequest({ url: '/api/ready', headers: { 'x-forwarded-for': caller } }), result.response)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://authorizer.example/ready',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(result.response.statusCode).toBe(503)
    expect(result.body()?.toString()).toBe(JSON.stringify({ ok: false }))
  })

  it('marks an oversized request as no-store without contacting the upstream', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = gatewayResponse()
    await gatewayHandler(
      gatewayRequest({
        method: 'POST',
        headers: { 'content-length': String(MAX_GATEWAY_BYTES + 1) },
      }),
      result.response,
    )
    expect(result.response.statusCode).toBe(413)
    expect(result.body()).toBe(JSON.stringify({ error: 'API request too large' }))
    expectLocalNoStore(result)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks unavailable and oversized upstream failures as no-store', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const unavailable = gatewayResponse()
    await gatewayHandler(gatewayRequest(), unavailable.response)
    expect(unavailable.response.statusCode).toBe(502)
    expect(unavailable.body()).toBe(JSON.stringify({ error: 'vault service is not running' }))
    expectLocalNoStore(unavailable)

    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(MAX_GATEWAY_BYTES + 1)))
    const oversized = gatewayResponse()
    await gatewayHandler(gatewayRequest(), oversized.response)
    expect(oversized.response.statusCode).toBe(502)
    expect(oversized.body()).toBe(JSON.stringify({ error: 'API response too large' }))
    expectLocalNoStore(oversized)
  })

  it('preserves an authenticated upstream status, body, and no-store policy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ challenge: 'issued' }), {
        status: 201,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = gatewayResponse()
    await gatewayHandler(gatewayRequest({ url: '/api/v1/passkey/challenge' }), result.response)
    expect(result.response.statusCode).toBe(201)
    expect(result.body()?.toString()).toBe(JSON.stringify({ challenge: 'issued' }))
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.headers.get('content-type')).toBe('application/json')
  })

  it('does not replace an upstream cache policy', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('ok', { status: 202, headers: { 'Cache-Control': 'private, max-age=7' } })),
    )
    const result = gatewayResponse()
    await gatewayHandler(gatewayRequest(), result.response)
    expect(result.response.statusCode).toBe(202)
    expect(result.body()?.toString()).toBe('ok')
    expect(result.headers.get('cache-control')).toBe('private, max-age=7')
  })
})

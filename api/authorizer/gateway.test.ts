import { describe, expect, it } from 'vitest'
import {
  allowAuthorizerPath,
  allowGatewayRate,
  MAX_GATEWAY_BYTES,
  readBoundedUpstream,
  sameOriginAllowed,
} from './[...path]'

describe('same-origin authorizer gateway', () => {
  it('only proxies health and /v1', () => {
    expect(allowAuthorizerPath('/health')).toBe(true)
    expect(allowAuthorizerPath('/v1/status')).toBe(true)
    expect(allowAuthorizerPath('/v1/enroll/start')).toBe(true)
    expect(allowAuthorizerPath('/')).toBe(false)
    expect(allowAuthorizerPath('/api/authorizer/v1/status')).toBe(false)
  })

  it('treats Origin as a CSRF filter, not authentication', () => {
    expect(
      sameOriginAllowed({
        host: 'arkade-vault-demo.vercel.app',
        origin: 'https://evil.example',
        secFetchSite: 'cross-site',
      }),
    ).toBe(false)
    expect(sameOriginAllowed({ host: 'arkade-vault-demo.vercel.app' })).toBe(true)
    expect(
      sameOriginAllowed({
        host: 'arkade-vault-demo.vercel.app',
        origin: 'https://arkade-vault-demo.vercel.app',
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

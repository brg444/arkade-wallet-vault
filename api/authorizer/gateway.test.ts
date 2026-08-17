import { describe, expect, it } from 'vitest'
import { allowAuthorizerPath, sameOriginAllowed } from './[...path]'

describe('same-origin authorizer gateway', () => {
  it('only proxies health and /v1', () => {
    expect(allowAuthorizerPath('/health')).toBe(true)
    expect(allowAuthorizerPath('/v1/status')).toBe(true)
    expect(allowAuthorizerPath('/v1/enroll/start')).toBe(true)
    expect(allowAuthorizerPath('/')).toBe(false)
    expect(allowAuthorizerPath('/api/authorizer/v1/status')).toBe(false)
  })

  it('rejects a cross-site browser request', () => {
    expect(
      sameOriginAllowed({
        host: 'arkade-vault-demo.vercel.app',
        origin: 'https://evil.example',
        secFetchSite: 'cross-site',
      }),
    ).toBe(false)
    expect(
      sameOriginAllowed({
        host: 'arkade-vault-demo.vercel.app',
        origin: 'https://arkade-vault-demo.vercel.app',
        secFetchSite: 'same-origin',
      }),
    ).toBe(true)
  })
})

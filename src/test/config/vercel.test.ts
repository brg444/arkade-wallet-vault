import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Vercel worker caching', () => {
  it.each(['/vault-wallet-service-worker.mjs'])('serves %s without caching', (source) => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[]
    }
    expect(config.headers.find((entry) => entry.source === source)?.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'no-store, max-age=0',
    })
  })

  it('allows only the release-pinned Lightning relay beyond same-origin connections', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[]
    }
    const csp = config.headers
      .find((entry) => entry.source === '/(.*)')
      ?.headers.find((header) => header.key === 'Content-Security-Policy')?.value
    const connectSrc = csp
      ?.split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .find(([name]) => name === 'connect-src')

    expect(connectSrc).toEqual(['connect-src', "'self'", 'https://mutinynet.arkade.sh', 'wss://nostr.arkade.sh'])
  })
})

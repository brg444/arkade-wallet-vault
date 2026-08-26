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
})

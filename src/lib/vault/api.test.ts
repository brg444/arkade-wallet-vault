import { afterEach, describe, expect, it, vi } from 'vitest'
import { vaultGet, vaultPost } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Vault HTTP compatibility boundary', () => {
  it('keeps GET requests on the same-origin /v1 path with JSON acceptance', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ enrolled: false }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(vaultGet<{ enrolled: boolean }>('/v1/status')).resolves.toEqual({ enrolled: false })
    expect(fetchMock).toHaveBeenCalledWith('/v1/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      body: undefined,
    })
  })

  it('keeps POST JSON and enrollment authentication headers byte-for-byte', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ vaultId: 'vault-a' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      vaultPost<{ vaultId: string }>(
        '/v1/enroll/start',
        { requested: true },
        { 'X-Vault-Enrollment-Token': 'invite-a' },
      ),
    ).resolves.toEqual({ vaultId: 'vault-a' })
    expect(fetchMock).toHaveBeenCalledWith('/v1/enroll/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Vault-Enrollment-Token': 'invite-a',
      },
      body: '{"requested":true}',
    })
  })

  it('returns successful JSON without changing its wire shape', async () => {
    const wire = {
      operationId: '11'.repeat(16),
      inputs: [{ txid: '22'.repeat(32), vout: 1, valueSats: 12_345 }],
      nested: { optional: null },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(wire)),
    )

    await expect(vaultPost('/v1/vtxo/reserve', { vaultId: 'vault-a' })).resolves.toEqual(wire)
  })

  it('surfaces a 4xx JSON error field exactly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'reservation already exists' }, 409)),
    )

    await expect(vaultPost('/v1/vtxo/reserve', {})).rejects.toThrow('reservation already exists')
  })

  it('surfaces a non-JSON 4xx body but hides server and proxy failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('request is invalid', { status: 400 }))
      .mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(vaultPost('/v1/passkey/challenge', {})).rejects.toThrow('request is invalid')
    await expect(vaultPost('/v1/passkey/challenge', {})).rejects.toThrow('vault service is not running')
  })

  it('maps malformed successful JSON to the existing service error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not-json', { status: 200 })),
    )

    await expect(vaultGet('/v1/status')).rejects.toThrow('vault service is not running')
  })
})

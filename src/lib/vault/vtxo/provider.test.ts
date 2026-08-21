import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  memoryBoardingIntentCache,
  queuedIntentIdForDuplicate,
  VaultArkProvider,
  type QueuedBoardingIntent,
} from './provider'

const originalFetch = globalThis.fetch

function arkError(code: number, name: string, message: string) {
  return JSON.stringify({
    code,
    message,
    details: [
      {
        '@type': 'type.googleapis.com/ark.v1.ErrorDetails',
        code,
        name,
        message,
        metadata: {},
      },
    ],
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('VaultArkProvider event stream', () => {
  it('parses split SSE data with an explicit streaming accept header', async () => {
    const bytes = new TextEncoder()
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.encode('data: {"stream'))
            controller.enqueue(bytes.encode('Started":{"id":"session-1"}}\n\n'))
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )
    const abort = new AbortController()
    const stream = new VaultArkProvider('/arkade').getEventStream(abort.signal, ['topic 1'])
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { type: 'stream_started', id: 'session-1' },
    })
    abort.abort()
    await stream.return()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/arkade/v1/batch/events?topics=topic%201',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'text/event-stream' }),
      }),
    )
  })

  it('preserves the Operator status and body instead of throwing EventSource error', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"Streaming Method Not Allowed"}', { status: 501 }))
    const stream = new VaultArkProvider('/arkade').getEventStream(new AbortController().signal, [])
    await expect(stream.next()).rejects.toThrow(/501.*Streaming Method Not Allowed/)
  })

  it('rejoins a cached UUID only when the duplicate proof names the same outpoints', async () => {
    const cache = memoryBoardingIntentCache()
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ intentId: 'queued-uuid' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(arkError(0, 'INTERNAL_ERROR', 'duplicated input, 11:0 already registered by another intent'), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(arkError(0, 'INTERNAL_ERROR', 'duplicated input, 22:0 already registered by another intent'), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    const provider = new VaultArkProvider('/arkade', { intentCache: cache })
    const register = (proof: string) =>
      provider.registerIntent({
        proof,
        message: {
          type: 'register',
          onchain_output_indexes: [],
          valid_at: 0,
          expire_at: 0,
          cosigners_public_keys: [],
        },
      })
    await expect(register('proof-a')).resolves.toBe('queued-uuid')
    await expect(register('proof-a')).resolves.toBe('queued-uuid')
    await expect(register('proof-b')).rejects.toThrow(/duplicated input/i)
  })

  it('refuses a stale UUID whose fingerprint does not match the current proof', () => {
    const stored: QueuedBoardingIntent = { intentId: 'old-uuid', fingerprint: 'opaque:proof-a' }
    expect(queuedIntentIdForDuplicate(stored, 'opaque:proof-a')).toBe('old-uuid')
    expect(queuedIntentIdForDuplicate(stored, 'opaque:proof-b')).toBeUndefined()
    expect(queuedIntentIdForDuplicate(undefined, 'opaque:proof-a')).toBeUndefined()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultArkProvider } from './provider'

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

  it('waits for an in-round intent to return to the queue before deleting it', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(arkError(0, 'INTERNAL_ERROR', 'duplicated input, 11:0 already registered by another intent'), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(arkError(23, 'INVALID_INTENT_PROOF', 'no matching intents found for intent proof'), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(arkError(23, 'INVALID_INTENT_PROOF', 'no matching intents found for intent proof'), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    const provider = new VaultArkProvider('/arkade', { attempts: 3, delayMs: 0 })
    await expect(
      provider.registerIntent({
        proof: 'proof',
        message: {
          type: 'register',
          onchain_output_indexes: [],
          valid_at: 0,
          expire_at: 0,
          cosigners_public_keys: [],
        },
      }),
    ).rejects.toThrow(/duplicated input/i)
    await expect(
      provider.deleteIntent({
        proof: 'proof',
        message: { type: 'delete' },
      }),
    ).resolves.toBeUndefined()
    expect(globalThis.fetch).toHaveBeenCalledTimes(4)
  })
})

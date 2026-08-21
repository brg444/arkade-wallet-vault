import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultArkProvider } from './provider'

const originalFetch = globalThis.fetch

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
})

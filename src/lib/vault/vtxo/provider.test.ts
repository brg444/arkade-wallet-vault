import { Transaction } from '@arkade-os/sdk'
import { base64 } from '@scure/base'
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

  it('reattaches to an identical queued intent instead of deleting it', async () => {
    const proof = new Transaction()
    proof.addInput({
      txid: new Uint8Array(32).fill(1),
      index: 0,
      witnessUtxo: { amount: 1n, script: new Uint8Array([0x51]) },
    })
    proof.addOutput({ amount: 1n, script: new Uint8Array([0x51]) })
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          message: 'duplicated input, 11:0 already registered by another intent',
          details: [],
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const proofBase64 = base64.encode(proof.toPSBT())
    const intentId = await new VaultArkProvider('/arkade').registerIntent({
      proof: proofBase64,
      message: {
        type: 'register',
        onchain_output_indexes: [],
        valid_at: 0,
        expire_at: 0,
        cosigners_public_keys: [],
      },
    })
    expect(intentId).toBe(Transaction.fromPSBT(base64.decode(proofBase64)).id)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })
})

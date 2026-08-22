import { Intent } from '@arkade-os/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boardingIntentFingerprint,
  intentRepositoryBoardingCache,
  memoryBoardingIntentCache,
  queuedIntentIdForDuplicate,
  VaultArkProvider,
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

  it('reconnects after a clean stream EOF so a later batch event is not dropped', async () => {
    const bytes = new TextEncoder()
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.close()
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                bytes.encode('data: {"batchStarted":{"id":"round-2","intentIdHashes":["abc"],"batchExpiry":100}}\n\n'),
              )
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      )
    const abort = new AbortController()
    const stream = new VaultArkProvider('/arkade', { streamReconnectMs: 1 }).getEventStream(abort.signal, [])
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { type: 'batch_started', id: 'round-2', intentIdHashes: ['abc'], batchExpiry: 100n },
    })
    abort.abort()
    await stream.return()
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
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

  it('fingerprints the full register proof and message, not only inputs', () => {
    const base = {
      proof: 'proof-a',
      message: {
        type: 'register' as const,
        onchain_output_indexes: [] as number[],
        valid_at: 0,
        expire_at: 0,
        cosigners_public_keys: [] as string[],
      },
    }
    const sameInputsDifferentOutputs = {
      ...base,
      message: { ...base.message, cosigners_public_keys: ['aa'] },
    }
    expect(boardingIntentFingerprint(base)).not.toBe(boardingIntentFingerprint(sameInputsDifferentOutputs))
    const stored = { intentId: 'old-uuid', fingerprint: boardingIntentFingerprint(base) }
    expect(queuedIntentIdForDuplicate(stored, boardingIntentFingerprint(base))).toBe('old-uuid')
    expect(queuedIntentIdForDuplicate(stored, boardingIntentFingerprint(sameInputsDifferentOutputs))).toBeUndefined()
  })

  it('rejoins a persisted SDK intent after a reload clears session memory', async () => {
    const register = {
      proof: 'proof-a',
      message: {
        type: 'register' as const,
        onchain_output_indexes: [] as number[],
        valid_at: 0,
        expire_at: 0,
        cosigners_public_keys: [] as string[],
      },
    }
    const fingerprint = boardingIntentFingerprint(register)
    const repo = {
      getIntents: vi.fn(async () => [
        {
          intentTxId: 'proof-txid',
          intentId: 'persisted-uuid',
          state: 'waiting_for_batch' as const,
          createdAt: 1,
          updatedAt: 1,
          registerProof: register.proof,
          registerProofMessage: Intent.encodeMessage(register.message),
          deleteProof: 'delete',
          deleteProofMessage: '{}',
          partialForfeits: [],
          intentVtxos: [{ txid: '11'.repeat(32), vout: 0 }],
        },
      ]),
    }
    const cache = intentRepositoryBoardingCache(repo)
    expect(cache.get()).toBeUndefined()
    await expect(cache.lookup?.(fingerprint)).resolves.toEqual({
      intentId: 'persisted-uuid',
      fingerprint,
    })

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(arkError(0, 'INTERNAL_ERROR', 'duplicated input, 11:0 already registered by another intent'), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const provider = new VaultArkProvider('/arkade', { intentCache: cache })
    await expect(provider.registerIntent(register)).resolves.toBe('persisted-uuid')
  })
})

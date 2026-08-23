import { Intent, type ArkIntent, type IntentFilter } from '@arkade-os/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  boardingIntentFingerprint,
  intentRepositoryBoardingCache,
  queuedIntentIdForDuplicate,
  VaultArkProvider,
  VaultIntentPersistenceError,
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

const registerRequest = {
  proof: 'proof-a',
  message: {
    type: 'register' as const,
    onchain_output_indexes: [] as number[],
    valid_at: 0,
    expire_at: 0,
    cosigners_public_keys: [] as string[],
  },
}

function intentRow(overrides: Partial<ArkIntent> = {}): ArkIntent {
  return {
    intentTxId: 'proof-txid',
    state: 'waiting_to_submit',
    createdAt: 1,
    updatedAt: 1,
    registerProof: registerRequest.proof,
    registerProofMessage: Intent.encodeMessage(registerRequest.message),
    deleteProof: 'delete',
    deleteProofMessage: '{}',
    partialForfeits: [],
    intentVtxos: [{ txid: '11'.repeat(32), vout: 0 }],
    ...overrides,
  }
}

class FakeIntentRepository {
  readonly rows = new Map<string, ArkIntent>()
  readonly saveIntent = vi.fn(async (intent: ArkIntent) => {
    this.rows.set(intent.intentTxId, { ...intent, updatedAt: Date.now() })
  })

  constructor(...rows: ArkIntent[]) {
    for (const row of rows) this.rows.set(row.intentTxId, row)
  }

  async getIntents(filter?: IntentFilter): Promise<ArkIntent[]> {
    return [...this.rows.values()].filter((intent) => {
      if (filter?.intentTxIds && !filter.intentTxIds.includes(intent.intentTxId)) return false
      if (filter?.states && !filter.states.includes(intent.state)) return false
      return true
    })
  }
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

  it('does not let a memory-only provider return an accepted Operator intent', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ intentId: 'queued-uuid' }), { status: 200 }))
    const provider = new VaultArkProvider('/arkade')
    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(VaultIntentPersistenceError)
  })

  it('persists and reads back an accepted UUID before returning it', async () => {
    const repo = new FakeIntentRepository(intentRow())
    const cache = intentRepositoryBoardingCache(repo)
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ intentId: 'queued-uuid' }), { status: 200 }))
    const provider = new VaultArkProvider('/arkade', { intentCache: cache })

    await expect(provider.registerIntent(registerRequest)).resolves.toBe('queued-uuid')
    expect(repo.saveIntent).toHaveBeenCalledTimes(1)
    expect(repo.rows.get('proof-txid')).toMatchObject({
      intentId: 'queued-uuid',
      state: 'waiting_for_batch',
      registerProof: registerRequest.proof,
      registerProofMessage: Intent.encodeMessage(registerRequest.message),
    })
    expect(cache.get()).toEqual({
      intentId: 'queued-uuid',
      fingerprint: boardingIntentFingerprint(registerRequest),
    })
  })

  it('rejoins a committed UUID only when the duplicate has the exact proof and message', async () => {
    const repo = new FakeIntentRepository(intentRow())
    const cache = intentRepositoryBoardingCache(repo)
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
        ...registerRequest,
        proof,
      })
    await expect(register('proof-a')).resolves.toBe('queued-uuid')
    await expect(register('proof-a')).resolves.toBe('queued-uuid')
    await expect(register('proof-b')).rejects.toThrow(/duplicated input/i)
  })

  it('fingerprints the full register proof and message, not only inputs', () => {
    const base = registerRequest
    const sameInputsDifferentOutputs = {
      ...base,
      message: { ...base.message, cosigners_public_keys: ['aa'] },
    }
    expect(boardingIntentFingerprint(base)).not.toBe(boardingIntentFingerprint(sameInputsDifferentOutputs))
    const stored = { intentId: 'old-uuid', fingerprint: boardingIntentFingerprint(base) }
    expect(queuedIntentIdForDuplicate(stored, boardingIntentFingerprint(base))).toBe('old-uuid')
    expect(queuedIntentIdForDuplicate(stored, boardingIntentFingerprint(sameInputsDifferentOutputs))).toBeUndefined()
  })

  it('rejoins after the accepted result is lost to the caller and the page reloads', async () => {
    const repo = new FakeIntentRepository(intentRow())
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ intentId: 'persisted-uuid' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(arkError(0, 'INTERNAL_ERROR', 'duplicated input, 11:0 already registered by another intent'), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const firstPage = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })
    await firstPage.registerIntent(registerRequest)

    const reloaded = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })
    await expect(reloaded.registerIntent(registerRequest)).resolves.toBe('persisted-uuid')
  })

  it('fails closed when the accepted UUID cannot be written durably', async () => {
    const repo = new FakeIntentRepository(intentRow())
    repo.saveIntent.mockRejectedValueOnce(new Error('IndexedDB transaction aborted'))
    const cache = intentRepositoryBoardingCache(repo)
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ intentId: 'queued-uuid' }), { status: 200 }))

    const provider = new VaultArkProvider('/arkade', { intentCache: cache })
    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/durably persist/)
    expect(repo.rows.get('proof-txid')?.intentId).toBeUndefined()
    expect(cache.get()).toBeUndefined()
  })

  it('fails closed when no exact SDK pre-registration row exists', async () => {
    const repo = new FakeIntentRepository()
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ intentId: 'queued-uuid' }), { status: 200 }))
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/no unique pre-registered proof and message/)
  })

  it('cannot recover a server-assigned UUID when the transport loses the HTTP response', async () => {
    const repo = new FakeIntentRepository(intentRow())
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed'))
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/request failed/)
    expect(repo.rows.get('proof-txid')?.intentId).toBeUndefined()
  })
})

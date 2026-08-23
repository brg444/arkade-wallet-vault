import { Intent, RestArkProvider, type ArkIntent, type IntentFilter } from '@arkade-os/sdk'
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

/** Runtime-compatible fixture until the installed SDK type includes the frozen state. */
function ambiguousIntentRow(): ArkIntent {
  const row = intentRow()
  Object.defineProperty(row, 'state', {
    configurable: true,
    enumerable: true,
    value: 'registration_ambiguous',
    writable: true,
  })
  return row
}

/** Structural fixture for the candidate SDK class without changing this wallet's package pin. */
function definitiveRegistrationRejection(): Error {
  return Object.assign(new Error('Operator rejected intent registration'), {
    name: 'IntentRegistrationRejectedError',
    httpStatus: 429,
    retryable: true,
  })
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
  vi.restoreAllMocks()
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

  it('persists an accepted UUID over the SDK registration_ambiguous write-ahead marker', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ intentId: 'queued-uuid' }), { status: 200 }))
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).resolves.toBe('queued-uuid')
    expect(repo.rows.get('proof-txid')).toMatchObject({
      intentId: 'queued-uuid',
      state: 'waiting_for_batch',
      registerProof: registerRequest.proof,
      registerProofMessage: Intent.encodeMessage(registerRequest.message),
    })
  })

  it('retries one identical request after a lost accepted response, then persists the retained UUID', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed after request delivery'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ intentId: 'retained-uuid' }), { status: 200 }))
    globalThis.fetch = fetchMock
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).resolves.toBe('retained-uuid')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = fetchMock.mock.calls[0][1]?.body
    const secondBody = fetchMock.mock.calls[1][1]?.body
    expect(secondBody).toBe(firstBody)
    expect(repo.rows.get('proof-txid')).toMatchObject({
      intentId: 'retained-uuid',
      state: 'waiting_for_batch',
    })
  })

  it('makes only two attempts and leaves registration_ambiguous locked when both results are ambiguous', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed after request delivery'))
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }))
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/unavailable/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(repo.saveIntent).not.toHaveBeenCalled()
    expect(repo.rows.get('proof-txid')).toMatchObject({ state: 'registration_ambiguous' })
  })

  it('does not retry an explicit Operator proof rejection', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(arkError(23, 'INVALID_INTENT_PROOF', 'no matching intents found for intent proof'), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/no matching intents/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(repo.saveIntent).not.toHaveBeenCalled()
    expect(repo.rows.get('proof-txid')).toMatchObject({ state: 'registration_ambiguous' })
  })

  it('does not retry the future typed proven registration rejection', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    const rejection = definitiveRegistrationRejection()
    const register = vi.spyOn(RestArkProvider.prototype, 'registerIntent').mockRejectedValue(rejection)
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toBe(rejection)
    expect(register).toHaveBeenCalledTimes(1)
    expect(repo.saveIntent).not.toHaveBeenCalled()
    expect(repo.rows.get('proof-txid')).toMatchObject({ state: 'registration_ambiguous' })
  })

  it('keeps an untyped rate-limit provider failure ambiguous and bounded', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }))
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/429/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(repo.saveIntent).not.toHaveBeenCalled()
    expect(repo.rows.get('proof-txid')).toMatchObject({ state: 'registration_ambiguous' })
  })

  it('keeps a structured 429 ArkError ambiguous and locked without retrying it', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(arkError(0, 'INTERNAL_ERROR', 'registration result unavailable'), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/registration result unavailable/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(repo.saveIntent).not.toHaveBeenCalled()
    expect(repo.rows.get('proof-txid')).toMatchObject({ state: 'registration_ambiguous' })
  })

  it('retries malformed 2xx JSON once and persists the retained intent ID', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"intentId":', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ intentId: 'retained-uuid' }), { status: 200 }))
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).resolves.toBe('retained-uuid')
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(repo.rows.get('proof-txid')).toMatchObject({
      intentId: 'retained-uuid',
      state: 'waiting_for_batch',
    })
  })

  it.each([
    ['missing', '{}'],
    ['empty', '{"intentId":""}'],
  ])('never persists a %s intent ID after the bounded retry', async (_case, body) => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    globalThis.fetch = vi.fn().mockImplementation(async () => new Response(body, { status: 200 }))
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/no intent ID/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(repo.saveIntent).not.toHaveBeenCalled()
    expect(repo.rows.get('proof-txid')).toMatchObject({ state: 'registration_ambiguous' })
  })

  it('leaves registration_ambiguous when the second bounded response is malformed', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Load failed after request delivery'))
      .mockResolvedValueOnce(new Response('{"intentId":', { status: 200 }))
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toBeInstanceOf(SyntaxError)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(repo.saveIntent).not.toHaveBeenCalled()
    expect(repo.rows.get('proof-txid')).toMatchObject({ state: 'registration_ambiguous' })
  })

  it('does not retry the registration POST after a digest mismatch', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(arkError(1, 'DIGEST_MISMATCH', 'server configuration changed'), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ network: 'mutinynet', digest: 'fresh' }), { status: 200 }))
    globalThis.fetch = fetchMock
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/digest mismatch/i)
    const registerCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/v1/batch/registerIntent'))
    expect(registerCalls).toHaveLength(1)
    expect(repo.saveIntent).not.toHaveBeenCalled()
    expect(repo.rows.get('proof-txid')).toMatchObject({ state: 'registration_ambiguous' })
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

  it('cannot recover a server-assigned UUID when both bounded HTTP responses are lost', async () => {
    const repo = new FakeIntentRepository(ambiguousIntentRow())
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Load failed'))
    const provider = new VaultArkProvider('/arkade', { intentCache: intentRepositoryBoardingCache(repo) })

    await expect(provider.registerIntent(registerRequest)).rejects.toThrow(/request failed/)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(repo.rows.get('proof-txid')?.intentId).toBeUndefined()
    expect(repo.rows.get('proof-txid')).toMatchObject({ state: 'registration_ambiguous' })
  })
})

import { Intent, RestArkProvider, type IntentRepository, type SettlementEvent } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'

const STREAM_RECONNECT_MS = 500
const LIVE_INTENT_STATES = ['waiting_to_submit', 'waiting_for_batch', 'batch_in_progress'] as const

export interface QueuedBoardingIntent {
  intentId: string
  fingerprint: string
}

export interface BoardingIntentCache {
  get(): QueuedBoardingIntent | undefined
  set(record: QueuedBoardingIntent): void
  clear(): void
  lookup?(fingerprint: string): Promise<QueuedBoardingIntent | undefined>
}

export function memoryBoardingIntentCache(): BoardingIntentCache {
  let record: QueuedBoardingIntent | undefined
  return {
    get: () => record,
    set: (next) => {
      record = next
    },
    clear: () => {
      record = undefined
    },
  }
}

/** Session memory plus the SDK intent repository. Reload reads the repo; the same tab uses memory. */
export function intentRepositoryBoardingCache(repo: Pick<IntentRepository, 'getIntents'>): BoardingIntentCache {
  const memory = memoryBoardingIntentCache()
  return {
    get: () => memory.get(),
    set: (record) => memory.set(record),
    clear: () => memory.clear(),
    async lookup(fingerprint) {
      const cached = memory.get()
      if (cached) return cached
      const live = await repo.getIntents({ states: [...LIVE_INTENT_STATES] })
      for (const intent of live) {
        if (!intent.intentId || !intent.registerProof || !intent.registerProofMessage) continue
        const stored = hex.encode(
          sha256(new TextEncoder().encode(`${intent.registerProof}\n${intent.registerProofMessage}`)),
        )
        if (stored === fingerprint) return { intentId: intent.intentId, fingerprint }
      }
      return undefined
    },
  }
}

/** Digest of the exact signed register request: proof PSBT plus encoded message. */
export function boardingIntentFingerprint(intent: {
  proof: string
  message: Parameters<typeof Intent.encodeMessage>[0]
}): string {
  const encoded = Intent.encodeMessage(intent.message)
  return hex.encode(sha256(new TextEncoder().encode(`${intent.proof}\n${encoded}`)))
}

export function queuedIntentIdForDuplicate(
  stored: QueuedBoardingIntent | undefined,
  fingerprint: string,
): string | undefined {
  if (!stored?.intentId || !fingerprint || stored.fingerprint !== fingerprint) return undefined
  return stored.intentId
}

function eventData(block: string): string | undefined {
  const lines = block.split(/\r?\n/)
  const data = lines
    .filter((line) => line === 'data' || line.startsWith('data:'))
    .map((line) => {
      const value = line === 'data' ? '' : line.slice(5)
      return value.startsWith(' ') ? value.slice(1) : value
    })
  return data.length > 0 ? data.join('\n') : undefined
}

async function responseDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).trim().slice(0, 240)
  } catch {
    return ''
  }
}

function isDuplicatedInput(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('duplicated input') && message.includes('already registered by another intent')
}

/**
 * Fetch SSE instead of native EventSource so HTTP failures keep status/body.
 * Reconnect after a clean EOF does not replay a missed BatchStarted; that ack
 * is still lost unless arkd emits it again on a later round.
 */
export class VaultArkProvider extends RestArkProvider {
  private readonly intentCache: BoardingIntentCache
  private readonly streamReconnectMs: number

  constructor(serverUrl: string, options: { intentCache?: BoardingIntentCache; streamReconnectMs?: number } = {}) {
    super(serverUrl)
    this.intentCache = options.intentCache ?? memoryBoardingIntentCache()
    this.streamReconnectMs = options.streamReconnectMs ?? STREAM_RECONNECT_MS
  }

  clearQueuedIntent() {
    this.intentCache.clear()
  }

  override async registerIntent(
    intent: Parameters<RestArkProvider['registerIntent']>[0],
  ): ReturnType<RestArkProvider['registerIntent']> {
    const fingerprint = boardingIntentFingerprint(intent)
    try {
      const intentId = await super.registerIntent(intent)
      this.intentCache.set({ intentId, fingerprint })
      return intentId
    } catch (error) {
      if (!isDuplicatedInput(error)) throw error
      const queued = queuedIntentIdForDuplicate(this.intentCache.get(), fingerprint)
      if (queued) return queued
      const stored = queuedIntentIdForDuplicate(await this.intentCache.lookup?.(fingerprint), fingerprint)
      if (stored) return stored
      throw error
    }
  }

  override async deleteIntent(
    intent: Parameters<RestArkProvider['deleteIntent']>[0],
  ): ReturnType<RestArkProvider['deleteIntent']> {
    await super.deleteIntent(intent)
    this.intentCache.clear()
  }

  override async *getEventStream(signal: AbortSignal, topics: string[]): AsyncIterableIterator<SettlementEvent> {
    const query = topics.length > 0 ? `?${topics.map((topic) => `topics=${encodeURIComponent(topic)}`).join('&')}` : ''
    while (!signal.aborted) {
      const response = await fetch(`${this.serverUrl}/v1/batch/events${query}`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
        signal,
      })
      if (!response.ok) {
        const detail = await responseDetail(response)
        throw new Error(`Operator event stream returned ${response.status}${detail ? `: ${detail}` : ''}`)
      }
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.toLowerCase().includes('text/event-stream')) {
        throw new Error(`Operator event stream returned ${contentType || 'an unknown content type'}`)
      }
      if (!response.body) throw new Error('Operator event stream returned no response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          buffer += decoder.decode(value, { stream: !done })
          for (;;) {
            const boundary = buffer.match(/\r?\n\r?\n/)
            if (!boundary || boundary.index == null) break
            const block = buffer.slice(0, boundary.index)
            buffer = buffer.slice(boundary.index + boundary[0].length)
            const data = eventData(block)
            if (!data) continue
            const event = this.parseSettlementEvent(JSON.parse(data))
            if (event) yield event
          }
          if (done) break
        }
        const trailing = eventData(buffer)
        if (trailing) {
          const event = this.parseSettlementEvent(JSON.parse(trailing))
          if (event) yield event
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      if (signal.aborted) return
      if (this.streamReconnectMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.streamReconnectMs))
      }
    }
  }
}

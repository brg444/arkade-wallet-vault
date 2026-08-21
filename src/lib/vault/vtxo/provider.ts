import { RestArkProvider, type SettlementEvent } from '@arkade-os/sdk'

const DELETE_RETRY_DELAY_MS = 250
const DELETE_RETRY_ATTEMPTS = 320

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

/**
 * The SDK's browser provider uses native EventSource, whose error callback
 * discards the HTTP status and response body. Use fetch streaming for the
 * settlement coordinator so Safari failures remain actionable and do not get
 * collapsed to the opaque string "EventSource error".
 */
export class VaultArkProvider extends RestArkProvider {
  private recoverQueuedIntent = false

  constructor(
    serverUrl: string,
    private readonly deleteRetry = { attempts: DELETE_RETRY_ATTEMPTS, delayMs: DELETE_RETRY_DELAY_MS },
  ) {
    super(serverUrl)
  }

  override async registerIntent(
    intent: Parameters<RestArkProvider['registerIntent']>[0],
  ): ReturnType<RestArkProvider['registerIntent']> {
    try {
      return await super.registerIntent(intent)
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : ''
      if (message.includes('duplicated input') && message.includes('already registered by another intent')) {
        this.recoverQueuedIntent = true
      }
      throw error
    }
  }

  override async deleteIntent(
    intent: Parameters<RestArkProvider['deleteIntent']>[0],
  ): ReturnType<RestArkProvider['deleteIntent']> {
    const attempts = this.recoverQueuedIntent ? this.deleteRetry.attempts : 1
    this.recoverQueuedIntent = false
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await super.deleteIntent(intent)
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message.toLowerCase() : ''
        if (!message.includes('no matching intents found for intent proof')) throw error
        if (attempt + 1 < attempts && this.deleteRetry.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.deleteRetry.delayMs))
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Unable to release the queued boarding intent')
  }

  override async *getEventStream(signal: AbortSignal, topics: string[]): AsyncIterableIterator<SettlementEvent> {
    const query = topics.length > 0 ? `?${topics.map((topic) => `topics=${encodeURIComponent(topic)}`).join('&')}` : ''
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
      if (!signal.aborted) throw new Error('Operator event stream closed before settlement completed')
    } finally {
      await reader.cancel().catch(() => {})
    }
  }
}

import { configureEventSource, type EventSourceLike } from '@arkade-os/sdk'

const SETTLEMENT_EVENTS_PATH = '/v1/batch/events'
const EVENT_SOURCE_CONNECTING = 0
/** Mainnet Operator SSE often takes several seconds before `open`/first event. */
const STREAM_READY_TIMEOUT_MS = 60_000

type NativeEventSourceFactory = (url: string) => EventSource

type SettlementStream = {
  topics: Set<string>
  ready: Promise<void>
  resolveReady: () => void
  rejectReady: (error: Error) => void
  state: 'connecting' | 'open' | 'closed'
  closed: boolean
}

const settlementStreams = new Set<SettlementStream>()

function armSettlementStream(record: SettlementStream): void {
  record.ready = new Promise<void>((resolve, reject) => {
    record.resolveReady = resolve
    record.rejectReady = reject
  })
  void record.ready.catch(() => undefined)
}

function settlementTopics(url: string): Set<string> | undefined {
  let parsed: URL
  try {
    parsed = new URL(url, 'https://local.invalid')
  } catch {
    return undefined
  }
  if (parsed.pathname !== SETTLEMENT_EVENTS_PATH) return undefined
  return new Set(parsed.searchParams.getAll('topics'))
}

/**
 * Keeps the stock EventSource reconnect loop intact for the settlement stream.
 * Native EventSource emits `error` while it is reconnecting; forwarding that
 * transient event makes the SDK close a connection the browser can recover.
 */
export function createVaultEventSourceFactory(
  nativeFactory: NativeEventSourceFactory = (url) => new EventSource(url),
): (url: string) => EventSourceLike {
  return (url) => {
    const source = nativeFactory(url)
    const topics = settlementTopics(url)
    if (!topics) return source

    const record: SettlementStream = {
      topics,
      ready: Promise.resolve(),
      resolveReady: () => undefined,
      rejectReady: () => undefined,
      state: 'connecting',
      closed: false,
    }
    armSettlementStream(record)
    settlementStreams.add(record)

    const messageListeners = new Set<(event: MessageEvent) => void>()
    const errorListeners = new Set<(event: MessageEvent) => void>()
    const markOpen = () => {
      if (record.closed) return
      record.state = 'open'
      record.resolveReady()
    }
    const onOpen = () => markOpen()
    const onMessage = (event: MessageEvent) => {
      markOpen()
      for (const listener of messageListeners) listener(event)
    }
    const onError = (event: Event) => {
      if (record.closed) return
      if (source.readyState === EVENT_SOURCE_CONNECTING) {
        if (record.state === 'open') {
          record.state = 'connecting'
          armSettlementStream(record)
        }
        return
      }
      settlementStreams.delete(record)
      record.state = 'closed'
      record.rejectReady(new Error('Vault settlement event stream failed before opening'))
      for (const listener of errorListeners) listener(event as MessageEvent)
    }
    source.addEventListener('open', onOpen)
    source.addEventListener('message', onMessage)
    source.addEventListener('error', onError)

    const close = () => {
      if (record.closed) return
      record.closed = true
      record.state = 'closed'
      settlementStreams.delete(record)
      source.removeEventListener('open', onOpen)
      source.removeEventListener('message', onMessage)
      source.removeEventListener('error', onError)
      source.close()
      record.rejectReady(new Error('Vault settlement event stream closed before opening'))
      messageListeners.clear()
      errorListeners.clear()
    }

    return {
      addEventListener(type, listener) {
        if (type === 'message') messageListeners.add(listener)
        else errorListeners.add(listener)
      },
      removeEventListener(type, listener) {
        if (type === 'message') messageListeners.delete(listener)
        else errorListeners.delete(listener)
      },
      close,
    }
  }
}

export function installVaultSettlementEventSource(): void {
  configureEventSource(createVaultEventSourceFactory())
}

/** Fail closed unless the outpoint-filtered Operator stream is already open. */
export async function waitForVaultSettlementStream(topic: string, timeoutMs = STREAM_READY_TIMEOUT_MS): Promise<void> {
  await Promise.resolve()
  const matching = [...settlementStreams].filter((candidate) => !candidate.closed && candidate.topics.has(topic))
  const stream = matching[matching.length - 1]
  if (!stream) throw new Error('Vault settlement event stream was not created before registration')

  const deadline = Date.now() + timeoutMs
  while (stream.state !== 'open') {
    if (stream.state === 'closed') throw new Error('Vault settlement event stream closed before registration')
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Vault settlement event stream did not become ready before registration')
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        stream.ready,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Vault settlement event stream did not become ready before registration')),
            remaining,
          )
        }),
      ])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }
}

import { describe, expect, it, vi } from 'vitest'
import {
  createFetchEventSource,
  createVaultEventSourceFactory,
  waitForVaultSettlementStream,
} from './settlementEventSource'

class FakeEventSource extends EventTarget {
  readyState = 0
  close = vi.fn(() => {
    this.readyState = 2
  })

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  reconnectingError() {
    this.readyState = 0
    this.dispatchEvent(new Event('error'))
  }

  fatalError() {
    this.readyState = 2
    this.dispatchEvent(new Event('error'))
  }

  message(data: string) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }
}

describe('Vault settlement EventSource', () => {
  it('waits for the outpoint-filtered stream and preserves native reconnects', async () => {
    const native = new FakeEventSource()
    const factory = createVaultEventSourceFactory(() => native as unknown as EventSource)
    const topic = `${'ab'.repeat(32)}:1`
    const source = factory(`https://mutinynet.arkade.sh/v1/batch/events?topics=${encodeURIComponent(topic)}`)
    const message = vi.fn()
    const error = vi.fn()
    source.addEventListener('message', message)
    source.addEventListener('error', error)

    const ready = waitForVaultSettlementStream(topic, 100)
    native.reconnectingError()
    expect(error).not.toHaveBeenCalled()

    native.open()
    await expect(ready).resolves.toBeUndefined()
    native.message('{"type":"streamStarted"}')
    expect(message).toHaveBeenCalledTimes(1)

    native.reconnectingError()
    let reconnected = false
    const reconnectReady = waitForVaultSettlementStream(topic, 100).then(() => {
      reconnected = true
    })
    await Promise.resolve()
    expect(reconnected).toBe(false)
    native.open()
    await reconnectReady

    native.fatalError()
    expect(error).toHaveBeenCalledTimes(1)
    source.close()
    expect(native.close).toHaveBeenCalledTimes(1)
  })

  it('treats the first settlement message as stream ready', async () => {
    const native = new FakeEventSource()
    const factory = createVaultEventSourceFactory(() => native as unknown as EventSource)
    const topic = `${'ab'.repeat(32)}:0`
    factory(`https://arkade.computer/v1/batch/events?topics=${encodeURIComponent(topic)}`)
    const ready = waitForVaultSettlementStream(topic, 100)
    native.message('{"streamStarted":{"id":"1"}}')
    await expect(ready).resolves.toBeUndefined()
  })

  it('tracks relative Operator settlement URLs', async () => {
    const native = new FakeEventSource()
    const factory = createVaultEventSourceFactory(() => native as unknown as EventSource)
    const topic = `${'aa'.repeat(32)}:7`
    const source = factory(`/v1/batch/events?topics=${encodeURIComponent(topic)}`)
    const ready = waitForVaultSettlementStream(topic, 100)
    native.open()
    await expect(ready).resolves.toBeUndefined()
    source.close()
  })

  it('waits for a settlement stream created after registration starts', async () => {
    const native = new FakeEventSource()
    const factory = createVaultEventSourceFactory(() => native as unknown as EventSource)
    const topic = `${'11'.repeat(32)}:0`
    const ready = waitForVaultSettlementStream(topic, 200)
    await Promise.resolve()
    factory(`https://arkade.computer/v1/batch/events?topics=${encodeURIComponent(topic)}`)
    native.open()
    await expect(ready).resolves.toBeUndefined()
  })

  it('fails closed when registration has no matching settlement stream', async () => {
    await expect(waitForVaultSettlementStream(`${'cd'.repeat(32)}:0`, 10)).rejects.toThrow(
      /was not created before registration/,
    )
  })

  it('leaves non-settlement EventSource behavior unchanged', () => {
    const native = new FakeEventSource()
    const factory = createVaultEventSourceFactory(() => native as unknown as EventSource)
    expect(factory('https://mutinynet.arkade.sh/v1/indexer/events')).toBe(native)
  })

  it('binds readiness to the newest stream for the same outpoint', async () => {
    const first = new FakeEventSource()
    const second = new FakeEventSource()
    const sources = [first, second]
    const factory = createVaultEventSourceFactory(() => sources.shift()! as unknown as EventSource)
    const topic = `${'ef'.repeat(32)}:0`
    const url = `https://mutinynet.arkade.sh/v1/batch/events?topics=${encodeURIComponent(topic)}`
    const firstWrapped = factory(url)
    first.open()
    const secondWrapped = factory(url)

    let ready = false
    const waiting = waitForVaultSettlementStream(topic, 100).then(() => {
      ready = true
    })
    await Promise.resolve()
    expect(ready).toBe(false)
    second.open()
    await waiting

    firstWrapped.close()
    secondWrapped.close()
  })
})

function hangingSse(chunks: string[] = []) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  let resolveCancel: () => void = () => undefined
  const cancelled = new Promise<void>((resolve) => {
    resolveCancel = resolve
  })
  const stream = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
    },
    cancel() {
      resolveCancel()
    },
  })
  return {
    response: new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push(chunk: string) {
      controller.enqueue(encoder.encode(chunk))
    },
    end() {
      controller.close()
    },
    cancelled,
  }
}

describe('Vault fetch settlement EventSource', () => {
  it('marks the Operator stream ready when fetch headers arrive', async () => {
    const sse = hangingSse()
    const fetchImpl = vi.fn(async () => sse.response)
    const factory = createVaultEventSourceFactory((url) => createFetchEventSource(url, fetchImpl))
    const topic = `${'ab'.repeat(32)}:0`
    const url = `https://arkade.computer/v1/batch/events?topics=${encodeURIComponent(topic)}`
    const source = factory(url)
    await expect(waitForVaultSettlementStream(topic, 500)).resolves.toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        headers: expect.objectContaining({ Accept: 'text/event-stream' }),
      }),
    )
    source.close()
    await sse.cancelled
  })

  it('forwards SSE data lines as settlement messages', async () => {
    const sse = hangingSse()
    const factory = createVaultEventSourceFactory((url) => createFetchEventSource(url, async () => sse.response))
    const topic = `${'cd'.repeat(32)}:1`
    const source = factory(`https://arkade.computer/v1/batch/events?topics=${encodeURIComponent(topic)}`)
    const message = vi.fn()
    source.addEventListener('message', message)
    await waitForVaultSettlementStream(topic, 500)
    sse.push('data: {"streamStarted":{"id":"1"}}\n\n')
    await vi.waitFor(() => expect(message).toHaveBeenCalledTimes(1))
    expect(message.mock.calls[0][0]).toEqual(expect.objectContaining({ data: '{"streamStarted":{"id":"1"}}' }))
    source.close()
  })

  it('reconnects after the Operator stream ends', async () => {
    const first = hangingSse()
    const second = hangingSse()
    const responses = [first.response, second.response]
    const fetchImpl = vi.fn(async () => {
      const next = responses.shift()
      if (!next) throw new Error('unexpected extra SSE fetch')
      return next
    })
    const factory = createVaultEventSourceFactory((url) => createFetchEventSource(url, fetchImpl))
    const topic = `${'ef'.repeat(32)}:0`
    const source = factory(`https://arkade.computer/v1/batch/events?topics=${encodeURIComponent(topic)}`)
    await waitForVaultSettlementStream(topic, 500)
    first.end()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2), { timeout: 2_000 })
    await expect(waitForVaultSettlementStream(topic, 500)).resolves.toBeUndefined()
    source.close()
  })
})

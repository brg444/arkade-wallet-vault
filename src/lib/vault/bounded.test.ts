import { describe, expect, it } from 'vitest'
import { MAX_API_RESPONSE_BYTES, readBounded } from './bounded'

describe('readBounded', () => {
  it('rejects a declared Content-Length over the cap before reading', async () => {
    const res = new Response('x', { headers: { 'Content-Length': String(MAX_API_RESPONSE_BYTES + 1) } })
    await expect(readBounded(res)).rejects.toThrow(/too large/)
  })

  it('rejects a streamed body that grows past the cap', async () => {
    const chunk = new Uint8Array(64 * 1024)
    const res = new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < 20; i++) controller.enqueue(chunk)
          controller.close()
        },
      }),
    )
    await expect(readBounded(res)).rejects.toThrow(/too large/)
  })

  it('returns a small JSON body', async () => {
    const res = new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
    expect(await readBounded(res)).toBe('{"ok":true}')
  })

  it('counts the non-streaming fallback in UTF-8 bytes, not JS string length', async () => {
    const euro = '€'.repeat(400_000)
    expect(euro.length).toBeLessThan(MAX_API_RESPONSE_BYTES)
    expect(new TextEncoder().encode(euro).byteLength).toBeGreaterThan(MAX_API_RESPONSE_BYTES)
    const res = {
      headers: new Headers(),
      body: null,
      text: async () => euro,
    } as unknown as Response
    await expect(readBounded(res)).rejects.toThrow(/too large/)
  })
})

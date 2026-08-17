export const MAX_API_RESPONSE_BYTES = 1024 * 1024

export async function readBounded(res: Response, maxBytes = MAX_API_RESPONSE_BYTES): Promise<string> {
  const declared = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('API response too large')
  }
  if (!res.body?.getReader) {
    const text = await res.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error('API response too large')
    return text
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('API response too large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(out)
}

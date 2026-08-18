export const PSBT_QR_PREFIX = 'ARKPSBT/1'
const FRAME_CHARS = 480

export function encodePsbtFrames(b64: string, max = FRAME_CHARS): string[] {
  const payload = String(b64 || '').replace(/\s+/g, '')
  if (!payload) throw new Error('psbt required')
  if (payload.length <= max) return [`${PSBT_QR_PREFIX}\n${payload}`]
  const chunks: string[] = []
  for (let i = 0; i < payload.length; i += max) chunks.push(payload.slice(i, i + max))
  return chunks.map((chunk, i) => `${PSBT_QR_PREFIX}/${chunks.length}/${i}\n${chunk}`)
}

export function parsePsbtFrame(raw: string): { total: number; index: number; payload: string } | null {
  const text = String(raw || '').trim()
  const match = text.match(/^ARKPSBT\/1(?:\/(\d+)\/(\d+))?\n([\s\S]+)$/)
  if (!match) return null
  const payload = match[3].replace(/\s+/g, '')
  if (!payload) return null
  if (!match[1]) return { total: 1, index: 0, payload }
  const total = Number(match[1])
  const index = Number(match[2])
  if (!Number.isInteger(total) || !Number.isInteger(index) || total < 1 || index < 0 || index >= total) {
    return null
  }
  return { total, index, payload }
}

export function createPsbtFrameBuffer() {
  const slots = new Map<number, string>()
  let total = 0
  return {
    add(raw: string) {
      const frame = parsePsbtFrame(raw)
      if (!frame) throw new Error('not a vault PSBT QR')
      if (total && frame.total !== total) throw new Error('QR parts do not match')
      total = frame.total
      slots.set(frame.index, frame.payload)
      return { have: slots.size, total }
    },
    complete() {
      if (!total || slots.size !== total) return ''
      const parts: string[] = []
      for (let i = 0; i < total; i++) {
        const part = slots.get(i)
        if (!part) return ''
        parts.push(part)
      }
      return parts.join('')
    },
  }
}

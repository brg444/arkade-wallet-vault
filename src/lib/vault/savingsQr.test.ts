import { describe, expect, it } from 'vitest'
import { createPsbtFrameBuffer, encodePsbtFrames, parsePsbtFrame } from './savingsQr'

describe('savings PSBT QR frames', () => {
  it('round-trips a small PSBT in one frame', () => {
    const frames = encodePsbtFrames('cHNidP8BAH0CAAAA')
    expect(frames).toHaveLength(1)
    const buf = createPsbtFrameBuffer()
    expect(buf.add(frames[0])).toEqual({ have: 1, total: 1 })
    expect(buf.complete()).toBe('cHNidP8BAH0CAAAA')
  })

  it('reassembles shards in any order', () => {
    const frames = encodePsbtFrames('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 10)
    expect(frames.length).toBeGreaterThan(1)
    const buf = createPsbtFrameBuffer()
    buf.add(frames[1])
    expect(buf.complete()).toBe('')
    buf.add(frames[0])
    if (frames[2]) buf.add(frames[2])
    if (frames[3]) buf.add(frames[3])
    expect(buf.complete()).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    expect(parsePsbtFrame('nope')).toBeNull()
  })
})

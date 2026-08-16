import { describe, expect, it } from 'vitest'
import { hashDescriptor } from './descriptor'
import { sampleDescriptor } from './sample'
import { clearWatchRecord, loadWatchRecord, saveWatchRecord } from './store'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => {
      data.delete(key)
    },
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

describe('watch-only store', () => {
  it('round-trips a hashed descriptor', () => {
    const storage = memoryStorage()
    const rec = saveWatchRecord(sampleDescriptor(), 'http://127.0.0.1:3002', storage)
    expect(rec.descriptorHash).toBe(hashDescriptor(sampleDescriptor()))
    expect(loadWatchRecord(storage)?.descriptor.operational.address).toBe(sampleDescriptor().operational.address)
  })

  it('rejects a tampered stored hash', () => {
    const storage = memoryStorage()
    saveWatchRecord(sampleDescriptor(), 'http://127.0.0.1:3002', storage)
    const raw = JSON.parse(storage.getItem('arkade-vault-watch-v3') || '{}')
    raw.descriptorHash = 'aa'.repeat(32)
    storage.setItem('arkade-vault-watch-v3', JSON.stringify(raw))
    expect(() => loadWatchRecord(storage)).toThrow(/hash/)
  })

  it('clears the watch record', () => {
    const storage = memoryStorage()
    saveWatchRecord(sampleDescriptor(), 'http://127.0.0.1:3002', storage)
    clearWatchRecord(storage)
    expect(loadWatchRecord(storage)).toBeNull()
  })
})

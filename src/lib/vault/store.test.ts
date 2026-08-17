import { describe, expect, it } from 'vitest'
import { hashDescriptor } from './descriptor'
import { sampleDescriptor } from './sample'
import { clearWatchRecord, loadWatchRecord, saveWatchRecord, watchStoreKey } from './store'

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
    const key = watchStoreKey(sampleDescriptor().vaultId)
    const raw = JSON.parse(storage.getItem(key) || '{}')
    raw.descriptorHash = 'aa'.repeat(32)
    storage.setItem(key, JSON.stringify(raw))
    expect(() => loadWatchRecord(storage)).toThrow(/hash/)
  })

  it('clears the watch record', () => {
    const storage = memoryStorage()
    saveWatchRecord(sampleDescriptor(), 'http://127.0.0.1:3002', storage)
    clearWatchRecord(storage)
    expect(loadWatchRecord(storage)).toBeNull()
  })

  it('namespaces watch records by vault id and keeps the unprefixed first vault', () => {
    const storage = memoryStorage()
    saveWatchRecord(sampleDescriptor(), 'http://127.0.0.1:3002', storage)
    const other = sampleDescriptor()
    other.vaultId = 'tenant-b'
    other.operational.address = 'tb1potheroperationaladdress0000000000000000000000000000000000'
    saveWatchRecord(other, 'http://127.0.0.1:3002', storage)
    expect(loadWatchRecord(storage)?.descriptor.vaultId).toBe(sampleDescriptor().vaultId)
    expect(loadWatchRecord(storage, 'tenant-b')?.descriptor.vaultId).toBe('tenant-b')
  })

  it('rejects a watch record stored under the wrong vault key', () => {
    const storage = memoryStorage()
    const rec = saveWatchRecord(sampleDescriptor(), 'http://127.0.0.1:3002', storage)
    storage.setItem(watchStoreKey('tenant-b'), JSON.stringify(rec))
    expect(() => loadWatchRecord(storage, 'tenant-b')).toThrow(/vault id/)
  })
})

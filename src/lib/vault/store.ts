import { WATCH_STORE_KEY } from './constants'
import { hashDescriptor, validateDescriptor } from './descriptor'
import type { VaultPublicDescriptor, WatchRecord } from './types'

export function loadWatchRecord(storage: Storage = localStorage): WatchRecord | null {
  const raw = storage.getItem(WATCH_STORE_KEY)
  if (!raw) return null
  const rec = JSON.parse(raw) as WatchRecord
  return requireWatchRecord(rec)
}

export function saveWatchRecord(
  descriptor: VaultPublicDescriptor,
  authorizerOrigin: string,
  storage: Storage = localStorage,
): WatchRecord {
  const valid = validateDescriptor(descriptor)
  const rec: WatchRecord = {
    descriptor: valid,
    descriptorHash: hashDescriptor(valid),
    importedAt: new Date().toISOString(),
    authorizerOrigin,
  }
  storage.setItem(WATCH_STORE_KEY, JSON.stringify(rec))
  return rec
}

export function clearWatchRecord(storage: Storage = localStorage) {
  storage.removeItem(WATCH_STORE_KEY)
}

function requireWatchRecord(rec: WatchRecord): WatchRecord {
  if (!rec?.descriptorHash || !rec.authorizerOrigin || !rec.importedAt) {
    throw new Error('incomplete watch record')
  }
  const descriptor = validateDescriptor(rec.descriptor)
  const hash = hashDescriptor(descriptor)
  if (hash !== rec.descriptorHash) throw new Error('watch record hash does not match descriptor')
  return { ...rec, descriptor, descriptorHash: hash }
}

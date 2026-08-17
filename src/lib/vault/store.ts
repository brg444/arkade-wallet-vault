import { VAULT_ID, WATCH_STORE_KEY } from './constants'
import { hashDescriptor, validateDescriptor } from './descriptor'
import type { VaultPublicDescriptor, WatchRecord } from './types'

export function watchStoreKey(vaultId = VAULT_ID): string {
  return `${WATCH_STORE_KEY}:${vaultId || VAULT_ID}`
}

export function loadWatchRecord(storage: Storage = localStorage, vaultId = VAULT_ID): WatchRecord | null {
  const id = vaultId || VAULT_ID
  const namespaced = storage.getItem(watchStoreKey(id))
  if (namespaced) return requireWatchRecord(JSON.parse(namespaced) as WatchRecord)
  if (id === VAULT_ID) {
    const raw = storage.getItem(WATCH_STORE_KEY)
    if (!raw) return null
    return requireWatchRecord(JSON.parse(raw) as WatchRecord)
  }
  return null
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
  storage.setItem(watchStoreKey(descriptor.vaultId || VAULT_ID), JSON.stringify(rec))
  return rec
}

export function clearWatchRecord(storage: Storage = localStorage, vaultId = VAULT_ID) {
  const id = vaultId || VAULT_ID
  storage.removeItem(watchStoreKey(id))
  if (id === VAULT_ID) storage.removeItem(WATCH_STORE_KEY)
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

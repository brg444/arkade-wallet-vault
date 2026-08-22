import { applyReplay, sessionKey, type ReplayRecord, type ReplayRequest, type ReplayStore } from './replay'

export const REPLAY_STORE_KEY = 'arkade-vault-v5-replay-v1'

function replayVaultKey(vaultId: string): string {
  const id = vaultId.trim()
  if (!id) throw new Error('vault id required')
  return `${REPLAY_STORE_KEY}:${id}`
}

function readAll(vaultId: string, storage: Storage): ReplayRecord[] {
  const raw = storage.getItem(replayVaultKey(vaultId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as ReplayRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function localReplayStore(vaultId: string, storage: Storage = localStorage): ReplayStore {
  return {
    get(key: string) {
      return readAll(vaultId, storage).find(
        (row) => sessionKey(row.vaultId, row.inputTxid, row.inputVout, row.purpose) === key,
      )
    },
    put(record: ReplayRecord) {
      const rows = readAll(vaultId, storage).filter(
        (row) =>
          sessionKey(row.vaultId, row.inputTxid, row.inputVout, row.purpose) !==
          sessionKey(record.vaultId, record.inputTxid, record.inputVout, record.purpose),
      )
      rows.push(record)
      storage.setItem(replayVaultKey(vaultId), JSON.stringify(rows))
    },
  }
}

export function applyLocalReplay(vaultId: string, req: ReplayRequest, storage: Storage = localStorage) {
  return applyReplay(localReplayStore(vaultId, storage), req)
}

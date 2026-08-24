import { requireSavingsPsbtIntent } from './savingsSpend'

const STORAGE_PREFIX = 'arkade-vault-savings-handoff-v1:'
export const SAVINGS_HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface PendingSavingsHandoff {
  version: 1
  vaultId: string
  psbtHex: string
  destAddress: string
  amountSats: number
  feeSats: number
  network: string
  createdAt: number
  expiresAt: number
}

type HandoffStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storageKey(vaultId: string): string {
  return `${STORAGE_PREFIX}${vaultId}`
}

function requireText(value: unknown, name: string): string {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${name} required`)
  return text
}

export function validatePendingSavingsHandoff(value: unknown, now = Date.now()): PendingSavingsHandoff {
  if (!value || typeof value !== 'object') throw new Error('pending Savings transfer is invalid')
  const input = value as Record<string, unknown>
  if (input.version !== 1) throw new Error('pending Savings transfer version is unsupported')
  const pending: PendingSavingsHandoff = {
    version: 1,
    vaultId: requireText(input.vaultId, 'vault id'),
    psbtHex: requireText(input.psbtHex, 'PSBT'),
    destAddress: requireText(input.destAddress, 'destination'),
    amountSats: Number(input.amountSats),
    feeSats: Number(input.feeSats),
    network: requireText(input.network, 'network'),
    createdAt: Number(input.createdAt),
    expiresAt: Number(input.expiresAt),
  }
  if (!Number.isSafeInteger(pending.amountSats) || pending.amountSats <= 0) {
    throw new Error('pending Savings amount is invalid')
  }
  if (!Number.isSafeInteger(pending.feeSats) || pending.feeSats < 0) {
    throw new Error('pending Savings fee is invalid')
  }
  if (!Number.isSafeInteger(pending.createdAt) || !Number.isSafeInteger(pending.expiresAt)) {
    throw new Error('pending Savings time is invalid')
  }
  if (pending.createdAt > now + 60_000 || pending.expiresAt > now + SAVINGS_HANDOFF_TTL_MS) {
    throw new Error('pending Savings time is invalid')
  }
  if (pending.expiresAt <= pending.createdAt || pending.expiresAt - pending.createdAt > SAVINGS_HANDOFF_TTL_MS) {
    throw new Error('pending Savings expiry is invalid')
  }
  if (pending.expiresAt <= now) throw new Error('pending Savings transfer expired')
  requireSavingsPsbtIntent(pending.psbtHex, pending.destAddress, pending.amountSats, pending.feeSats, pending.network)
  return pending
}

export function createPendingSavingsHandoff(
  input: Pick<PendingSavingsHandoff, 'vaultId' | 'psbtHex' | 'destAddress' | 'amountSats' | 'feeSats' | 'network'>,
  now = Date.now(),
): PendingSavingsHandoff {
  return validatePendingSavingsHandoff(
    {
      version: 1,
      ...input,
      createdAt: now,
      expiresAt: now + SAVINGS_HANDOFF_TTL_MS,
    },
    now,
  )
}

export function savePendingSavingsHandoff(storage: HandoffStorage, pending: PendingSavingsHandoff): void {
  const valid = validatePendingSavingsHandoff(pending)
  storage.setItem(storageKey(valid.vaultId), JSON.stringify(valid))
}

export function loadPendingSavingsHandoff(
  storage: HandoffStorage,
  vaultId: string,
  now = Date.now(),
): PendingSavingsHandoff | null {
  const key = storageKey(vaultId)
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const pending = validatePendingSavingsHandoff(JSON.parse(raw), now)
    if (pending.vaultId !== vaultId) throw new Error('pending Savings vault does not match')
    return pending
  } catch {
    try {
      storage.removeItem(key)
    } catch {
      // The invalid record remains inaccessible when browser storage is unavailable.
    }
    return null
  }
}

export function clearPendingSavingsHandoff(storage: HandoffStorage, vaultId: string): void {
  storage.removeItem(storageKey(vaultId))
}

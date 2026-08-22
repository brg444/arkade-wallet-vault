export const SESSION_STATES = [
  'idle',
  'requested',
  'broadcast',
  'pending',
  'claimable',
  'cancelled',
  'claimed',
  'reorged',
  'conflicted',
] as const

export type SessionState = (typeof SESSION_STATES)[number]

export type SpendKind = 'quarantine' | 'other'

export interface PendingCoin {
  txid: string
  vout: number
  value: number
  confirmed: boolean
  blockHeight?: number
}

export interface ObservedSpend {
  txid: string
  confirmed: boolean
  dest: SpendKind
}

/** Chain facts only. Do not persist claimable or confirmedHeight as irreversible. */
export interface SessionView {
  tipHeight: number
  pending?: PendingCoin
  spends?: ObservedSpend[]
  previouslyConfirmedHeight?: number
  requested?: boolean
}

export interface SessionSnapshot {
  state: SessionState
  confirmedHeight: number | null
  age: number | null
  remaining: number | null
  claimable: boolean
}

export function pendingAge(confirmedHeight: number, tipHeight: number): number {
  if (!Number.isInteger(confirmedHeight) || !Number.isInteger(tipHeight)) throw new Error('heights required')
  if (confirmedHeight < 1 || tipHeight < confirmedHeight) return 0
  return tipHeight - confirmedHeight + 1
}

export function remainingCsv(delay: number, confirmedHeight: number | null, tipHeight: number): number | null {
  if (!Number.isInteger(delay) || delay < 1) throw new Error('csv delay required')
  if (confirmedHeight === null) return delay
  return Math.max(0, delay - pendingAge(confirmedHeight, tipHeight))
}

export function deriveSession(delay: number, view: SessionView): SessionSnapshot {
  if (!Number.isInteger(delay) || delay < 1) throw new Error('csv delay required')
  if (!Number.isInteger(view.tipHeight) || view.tipHeight < 0) throw new Error('tip height required')

  const spends = view.spends || []
  const confirmedSpends = spends.filter((s) => s.confirmed)
  const kinds = new Set(spends.map((s) => s.dest))
  if (kinds.size > 1) {
    return {
      state: 'conflicted',
      confirmedHeight: view.pending?.blockHeight ?? view.previouslyConfirmedHeight ?? null,
      age: null,
      remaining: null,
      claimable: false,
    }
  }

  const confirmedHeight = view.pending?.confirmed && view.pending.blockHeight ? view.pending.blockHeight : null
  const age = confirmedHeight === null ? null : pendingAge(confirmedHeight, view.tipHeight)
  const remaining = remainingCsv(delay, confirmedHeight, view.tipHeight)
  const claimable = remaining === 0 && confirmedHeight !== null && confirmedSpends.length === 0

  if (view.previouslyConfirmedHeight && !view.pending && confirmedSpends.length === 0) {
    return { state: 'reorged', confirmedHeight: null, age: null, remaining: delay, claimable: false }
  }
  if (view.previouslyConfirmedHeight && view.pending && !view.pending.confirmed && confirmedSpends.length === 0) {
    return { state: 'reorged', confirmedHeight: null, age: null, remaining: delay, claimable: false }
  }

  if (confirmedSpends.length > 0) {
    const dest = confirmedSpends[0].dest
    return {
      state: dest === 'quarantine' ? 'cancelled' : 'claimed',
      confirmedHeight,
      age,
      remaining,
      claimable: false,
    }
  }

  if (view.pending?.confirmed) {
    return {
      state: claimable ? 'claimable' : 'pending',
      confirmedHeight,
      age,
      remaining,
      claimable,
    }
  }

  if (view.pending && !view.pending.confirmed) {
    return { state: 'broadcast', confirmedHeight: null, age: null, remaining: delay, claimable: false }
  }

  if (spends.some((s) => !s.confirmed)) {
    return { state: 'broadcast', confirmedHeight: null, age: null, remaining: delay, claimable: false }
  }

  if (view.requested) {
    return { state: 'requested', confirmedHeight: null, age: null, remaining: delay, claimable: false }
  }

  return { state: 'idle', confirmedHeight: null, age: null, remaining: delay, claimable: false }
}

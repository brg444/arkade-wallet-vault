const DECAY_MS = 220
const MAX_SPEED = 2.5 // CSS pixels per millisecond.
const MIN_SPEED = 0.12
const VELOCITY_WINDOW_MS = 100

export type LauncherSample = { y: number; time: number }

export function launcherReleaseVelocity(samples: LauncherSample[], releasedAt: number) {
  if (samples.length < 2) return 0
  const cutoff = releasedAt - VELOCITY_WINDOW_MS
  const index = samples.findIndex((sample) => sample.time >= cutoff)
  if (index < 0) return 0
  let first = samples[index]
  const before = samples[index - 1]
  if (before && first.time > before.time) {
    const fraction = (cutoff - before.time) / (first.time - before.time)
    first = { y: before.y + (first.y - before.y) * fraction, time: cutoff }
  }
  const last = samples[samples.length - 1]
  const duration = last.time - first.time
  return duration < 8 ? 0 : (last.y - first.y) / duration
}

/** Exponential deceleration with a bounded destination and no edge overshoot. */
export function launcherCoast(from: number, velocity: number, min: number, max: number) {
  const speed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, velocity))
  const target = Math.max(min, Math.min(max, from + speed * DECAY_MS))
  const distance = target - from
  if (Math.abs(speed) < MIN_SPEED || Math.abs(distance) < 1) return null
  // Shorten the decay near an edge so release speed is preserved while braking.
  const decay = Math.max(40, Math.min(DECAY_MS, Math.abs(distance / speed)))
  return (elapsed: number) => {
    const remaining = distance * Math.exp(-Math.max(0, elapsed) / decay)
    const done = Math.abs(remaining) < 0.5 || elapsed >= 1_200
    return { y: done ? target : target - remaining, done }
  }
}

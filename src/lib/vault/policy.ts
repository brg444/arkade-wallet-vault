export function waitLabel(blocks: number, network?: string): string {
  const secondsPerBlock = network === 'mutinynet' ? 30 : 600
  return humanDuration(Math.max(0, blocks) * secondsPerBlock)
}

export function delayLabel(blocks: number, network?: string): string {
  return `${blocks.toLocaleString()} blocks · ${waitLabel(blocks, network)}`
}

export function humanDuration(seconds: number): string {
  if (seconds < 90) return 'about a minute'
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.round(seconds / 60))
    return `about ${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  if (seconds < 86400) {
    const hours = Math.max(1, Math.round(seconds / 3600))
    return `about ${hours} hour${hours === 1 ? '' : 's'}`
  }
  const days = Math.max(1, Math.round(seconds / 86400))
  return `about ${days} day${days === 1 ? '' : 's'}`
}

export function truncateAddress(value: string, edge = 6): string {
  const trimmed = value.trim()
  if (trimmed.length <= edge * 2 + 3) return trimmed || '—'
  return `${trimmed.slice(0, edge)}…${trimmed.slice(-edge)}`
}

/** Product domains for Vaulted. These are not Operator or program pins. */
export const VAULTED_MARKETING_ORIGIN = 'https://getvaulted.xyz'
export const VAULTED_WALLET_ORIGIN = 'https://app.getvaulted.xyz'
export const VAULTED_WALLET_RP_ID = 'app.getvaulted.xyz'
export const VAULTED_GUARDIAN_HOST = 'guardian.getvaulted.xyz'
export const VAULTED_RC_ORIGIN = 'https://rc.getvaulted.xyz'
export const VAULTED_RC_RP_ID = 'rc.getvaulted.xyz'

export const MAINNET_WALLET_ORIGINS = [VAULTED_WALLET_ORIGIN, VAULTED_RC_ORIGIN] as const
export const MAINNET_WALLET_RP_IDS = [VAULTED_WALLET_RP_ID, VAULTED_RC_RP_ID] as const
export const MAINNET_WALLET_HOSTS = [VAULTED_WALLET_RP_ID, VAULTED_RC_RP_ID] as const

export function canonicalHttpOrigin(value: unknown): string {
  const raw = String(value || '').trim()
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('origin is not a valid URL')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('origin must contain only scheme and host')
  }
  if (parsed.protocol !== 'https:') throw new Error('origin must be https')
  const origin = `${parsed.protocol}//${parsed.host.toLowerCase()}`
  if (raw !== origin) throw new Error('origin must be canonical lowercase https://host')
  return origin
}

export function isMainnetWalletOrigin(value: unknown): boolean {
  try {
    return (MAINNET_WALLET_ORIGINS as readonly string[]).includes(canonicalHttpOrigin(value))
  } catch {
    return false
  }
}

export function isMainnetWalletHost(value: unknown): boolean {
  const host = String(value || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .split(':')[0]
  return (MAINNET_WALLET_HOSTS as readonly string[]).includes(host)
}

export function requireMainnetWalletOrigin(value: unknown): string {
  const origin = canonicalHttpOrigin(value)
  if (!(MAINNET_WALLET_ORIGINS as readonly string[]).includes(origin)) {
    throw new Error('mainnet wallet origin is not this release')
  }
  return origin
}

export function requireMainnetWalletRpId(value: unknown): string {
  const rpId = String(value || '')
    .trim()
    .toLowerCase()
  if (!(MAINNET_WALLET_RP_IDS as readonly string[]).includes(rpId)) {
    throw new Error('mainnet RP ID is not this release')
  }
  return rpId
}

/**
 * Passkeys are bound to the authorizer's rpId. This RC pins that to one host
 * (`rc.getvaulted.xyz` today). The other wallet alias must move there before
 * any WebAuthn ceremony, or Face ID looks up the wrong RP ID.
 */
export function authorizerWalletHref(clientOrigin: string, currentHref: string): string | undefined {
  const canonical = requireMainnetWalletOrigin(clientOrigin)
  let current: URL
  try {
    current = new URL(currentHref)
  } catch {
    return undefined
  }
  const here = `${current.protocol}//${current.host.toLowerCase()}`
  if (!isMainnetWalletOrigin(here) || here === canonical) return undefined
  const next = new URL(currentHref)
  const dest = new URL(canonical)
  next.protocol = dest.protocol
  next.host = dest.host
  return next.toString()
}

import { hex } from '@scure/base'
import { CLAIMANTS, familyKeysFor, type Claimant, type FamilyKey } from './constants'
import { remainingCsv } from './session'
import { pendingDelay, pendingGuardians, type VaultProgramFamily } from './trees'

export type CoinRole = 'normal' | 'pending' | 'quarantine'

export type CoinClass =
  | { role: 'normal' }
  | { role: 'pending'; claimant: Claimant }
  | { role: 'quarantine'; claimant: Claimant }
  | { role: 'unknown' }

export type Intent =
  | { type: 'admin' }
  | { type: 'initiate'; claimant: Claimant }
  | { type: 'clawback'; guardian: Claimant }
  | { type: 'claim' }
  | { type: 'quarantine-rotate' }

export type RouteExecutor = 'l1AdminPsbt' | 'l1Initiate' | 'l1Clawback' | 'l1Claim' | 'l1QuarantineAdmin'

export type RoutePurpose = 'admin' | 'exit' | 'recover'

export type RouteLeaf = 'admin' | 'initiate' | 'clawback' | 'claim' | 'quarantine-admin'

export interface Route {
  class: Exclude<CoinClass, { role: 'unknown' }>
  intent: Intent
  executor: RouteExecutor
  purpose: RoutePurpose
  leaf: RouteLeaf
}

export interface RouteContext {
  hasRecovery?: boolean
  tipHeight?: number
  confirmedHeight?: number
  availableKeys?: {
    phone?: boolean
    hardware?: boolean
    recovery?: boolean
    cosigners?: boolean
  }
}

export class RouteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RouteError'
  }
}

function scriptHex(script: Uint8Array | string): string {
  return (typeof script === 'string' ? script : hex.encode(script)).toLowerCase()
}

function parseFamilyKey(key: FamilyKey): { claimant: Claimant } {
  const [, claimant] = key.split('-') as ['savings', Claimant]
  return { claimant }
}

export function classifyScript(family: VaultProgramFamily, script: Uint8Array | string): CoinClass {
  const needle = scriptHex(script)
  if (scriptHex(family.savings.script) === needle) return { role: 'normal' }
  for (const key of familyKeysFor(Boolean(family.pending['savings-recovery']))) {
    if (scriptHex(family.pending[key].script) === needle) {
      return { role: 'pending', ...parseFamilyKey(key) }
    }
    if (scriptHex(family.quarantine[key].script) === needle) {
      return { role: 'quarantine', ...parseFamilyKey(key) }
    }
  }
  return { role: 'unknown' }
}

function requireClaimant(value: string, name: string): Claimant {
  if (!(CLAIMANTS as readonly string[]).includes(value))
    throw new RouteError(`${name} must be phone, hardware, or recovery`)
  return value as Claimant
}

function requireKey(ctx: RouteContext | undefined, role: Claimant | 'cosigners', message: string) {
  const keys = ctx?.availableKeys
  if (!keys) return
  if (role === 'cosigners') {
    if (keys.cosigners === false) throw new RouteError(message)
    return
  }
  if (keys[role] === false) throw new RouteError(message)
}

export function selectRoute(coin: CoinClass, intent: Intent, ctx?: RouteContext): Route {
  if (coin.role === 'unknown') throw new RouteError('unknown script is not a current Vault Program coin')
  const hasRecovery = ctx?.hasRecovery ?? true

  if (intent.type === 'admin') {
    if (coin.role !== 'normal') throw new RouteError('admin is only allowed from Normal')
    requireKey(ctx, 'phone', 'admin needs this device')
    requireKey(ctx, 'hardware', 'admin needs hardware')
    return { class: coin, intent, executor: 'l1AdminPsbt', purpose: 'admin', leaf: 'admin' }
  }

  if (intent.type === 'initiate') {
    const claimant = requireClaimant(intent.claimant, 'claimant')
    if (claimant === 'recovery' && !hasRecovery) throw new RouteError('Standard protection has no recovery claimant')
    if (coin.role !== 'normal') throw new RouteError('initiate is only allowed from Normal')
    requireKey(ctx, 'cosigners', 'initiate needs both cosigners')
    requireKey(ctx, claimant, `initiate needs the ${claimant} key`)
    return {
      class: coin,
      intent: { type: 'initiate', claimant },
      executor: 'l1Initiate',
      purpose: claimant === 'recovery' ? 'recover' : 'exit',
      leaf: 'initiate',
    }
  }

  if (intent.type === 'clawback') {
    const guardian = requireClaimant(intent.guardian, 'guardian')
    if (coin.role !== 'pending') throw new RouteError('clawback is only allowed from Pending')
    if (!pendingGuardians(coin.claimant, hasRecovery).includes(guardian)) {
      throw new RouteError('guardian cannot claw back this pending output')
    }
    requireKey(ctx, 'cosigners', 'clawback needs both cosigners')
    requireKey(ctx, guardian, `clawback needs the ${guardian} key`)
    return {
      class: coin,
      intent: { type: 'clawback', guardian },
      executor: 'l1Clawback',
      purpose: 'exit',
      leaf: 'clawback',
    }
  }

  if (intent.type === 'claim') {
    if (coin.role !== 'pending') throw new RouteError('claim is only allowed from Pending')
    requireKey(ctx, coin.claimant, `claim needs the ${coin.claimant} key`)
    if (ctx?.tipHeight !== undefined && ctx.confirmedHeight !== undefined) {
      const remaining = remainingCsv(pendingDelay(coin.claimant), ctx.confirmedHeight, ctx.tipHeight)
      if (remaining !== 0) throw new RouteError('pending CSV is not mature')
    }
    return {
      class: coin,
      intent,
      executor: 'l1Claim',
      purpose: coin.claimant === 'recovery' ? 'recover' : 'exit',
      leaf: 'claim',
    }
  }

  if (coin.role !== 'quarantine') throw new RouteError('quarantine-rotate is only allowed from Quarantine')
  if (coin.claimant === 'recovery' && !hasRecovery) throw new RouteError('Standard protection has no recovery claimant')
  for (const guardian of pendingGuardians(coin.claimant, hasRecovery)) {
    requireKey(ctx, guardian, `quarantine-rotate needs ${guardian}`)
  }
  return { class: coin, intent, executor: 'l1QuarantineAdmin', purpose: 'admin', leaf: 'quarantine-admin' }
}

export function selectScriptRoute(
  family: VaultProgramFamily,
  script: Uint8Array | string,
  intent: Intent,
  ctx?: RouteContext,
): Route {
  return selectRoute(classifyScript(family, script), intent, {
    ...ctx,
    hasRecovery: Boolean(family.pending['savings-recovery']),
  })
}

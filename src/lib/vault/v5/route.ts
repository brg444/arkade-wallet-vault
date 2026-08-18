import { hex } from '@scure/base'
import { CLAIMANTS, FAMILY_KEYS, type Claimant, type FamilyKey, type VaultKind } from './constants'
import { remainingCsv } from './session'
import { pendingDelay, pendingGuardians, type V5Family } from './trees'

export type CoinRole = 'normal' | 'pending' | 'quarantine'

export type CoinClass =
  | { role: 'normal'; kind: VaultKind }
  | { role: 'pending'; kind: VaultKind; claimant: Claimant }
  | { role: 'quarantine'; kind: VaultKind; claimant: Claimant }
  | { role: 'unknown' }

export type Intent =
  | { type: 'pay' }
  | { type: 'admin' }
  | { type: 'initiate'; claimant: Claimant }
  | { type: 'clawback'; guardian: Claimant }
  | { type: 'claim' }
  | { type: 'quarantine-rotate' }

export type RouteExecutor =
  | 'l1RoutineCeremony'
  | 'l1AdminPsbt'
  | 'l1Initiate'
  | 'l1Clawback'
  | 'l1Claim'
  | 'l1QuarantineAdmin'

export type RoutePurpose = 'spend' | 'admin' | 'exit' | 'recover'

export type RouteLeaf = 'routine' | 'admin' | 'initiate' | 'clawback' | 'claim' | 'quarantine-admin'

export interface Route {
  class: Exclude<CoinClass, { role: 'unknown' }>
  intent: Intent
  executor: RouteExecutor
  purpose: RoutePurpose
  leaf: RouteLeaf
}

export interface RouteContext {
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

function parseFamilyKey(key: FamilyKey): { kind: VaultKind; claimant: Claimant } {
  const [kind, claimant] = key.split('-') as [VaultKind, Claimant]
  return { kind, claimant }
}

export function classifyScript(family: V5Family, script: Uint8Array | string): CoinClass {
  const needle = scriptHex(script)
  if (scriptHex(family.daily.script) === needle) return { role: 'normal', kind: 'daily' }
  if (scriptHex(family.savings.script) === needle) return { role: 'normal', kind: 'savings' }
  for (const key of FAMILY_KEYS) {
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
  if (coin.role === 'unknown') throw new RouteError('unknown script is not a v5 vault coin')

  if (intent.type === 'pay') {
    if (coin.role !== 'normal' || coin.kind !== 'daily') {
      throw new RouteError('pay is only allowed from Daily Normal')
    }
    return { class: coin, intent, executor: 'l1RoutineCeremony', purpose: 'spend', leaf: 'routine' }
  }

  if (intent.type === 'admin') {
    if (coin.role !== 'normal') throw new RouteError('admin is only allowed from Normal')
    requireKey(ctx, 'phone', 'admin needs this device')
    requireKey(ctx, 'hardware', 'admin needs hardware')
    return { class: coin, intent, executor: 'l1AdminPsbt', purpose: 'admin', leaf: 'admin' }
  }

  if (intent.type === 'initiate') {
    const claimant = requireClaimant(intent.claimant, 'claimant')
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
    if (!pendingGuardians(coin.claimant).includes(guardian)) {
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
  const [a, b] =
    coin.claimant === 'phone'
      ? (['hardware', 'recovery'] as const)
      : coin.claimant === 'hardware'
        ? (['phone', 'recovery'] as const)
        : (['phone', 'hardware'] as const)
  requireKey(ctx, a, `quarantine-rotate needs ${a}`)
  requireKey(ctx, b, `quarantine-rotate needs ${b}`)
  return { class: coin, intent, executor: 'l1QuarantineAdmin', purpose: 'admin', leaf: 'quarantine-admin' }
}

export function selectScriptRoute(
  family: V5Family,
  script: Uint8Array | string,
  intent: Intent,
  ctx?: RouteContext,
): Route {
  return selectRoute(classifyScript(family, script), intent, ctx)
}

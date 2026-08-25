import type { NetworkName } from '@arkade-os/sdk'
import { discover, planOffer, sideLimits, type LocalCardInput, type Market } from '@arkade-os/solver-discovery'
import mutinynetSolverCard from './ln-solver-mutinynet.card.json'

const LIGHTNING_SEND_RELEASE_FLAG = 'true'

export interface VaultLightningSolverProfile {
  network: NetworkName
  pubkey: string
  relays: readonly string[]
  minSats: number
  maxSats: number
  maxFundingSats: number
  market: Market
}

const MUTINYNET_LIGHTNING_MARKET = mutinynetSolverCard.markets[0] as unknown as Market

/** Release-pinned Mutinynet solver. The bundled card is its source of truth. */
export const MUTINYNET_LIGHTNING_SOLVER: VaultLightningSolverProfile = {
  network: 'mutinynet',
  pubkey: '3f831510a6d7678d0c90d7d6fbc4057720517e2e30681ef4c87cc57aaf57e8d5',
  relays: ['wss://nostr.arkade.sh'],
  minSats: 1_000,
  maxSats: 25_000,
  maxFundingSats: 50_000,
  market: MUTINYNET_LIGHTNING_MARKET,
}

const MUTINYNET_LIGHTNING_CARD: LocalCardInput = {
  card: mutinynetSolverCard,
  network: 'mutinynet',
  label: 'bundled:ln-solver-mutinynet',
}

/**
 * Validate the release-pinned solver card through the same discovery package
 * used by the official wallet, then project only the Lightning-send market.
 * No registry is followed here: a network response cannot redirect Vault
 * funding to a different solver or relay.
 */
export async function discoverVaultLightningSolver(
  network: NetworkName,
): Promise<VaultLightningSolverProfile | undefined> {
  if (network !== 'mutinynet') return undefined
  const { markets, sources } = await discover({
    network,
    registries: [],
    localCards: [MUTINYNET_LIGHTNING_CARD],
  })
  if (!sources.some((source) => source.ok && source.source === MUTINYNET_LIGHTNING_CARD.label)) return undefined
  const market = markets.find(
    (candidate) =>
      candidate.quote_corridor === 'lightning' &&
      candidate.base_asset.id === 'btc' &&
      candidate.quote_asset.id === 'btc' &&
      candidate.discovery_pubkey === MUTINYNET_LIGHTNING_SOLVER.pubkey,
  )
  if (!market) return undefined
  const quoteLimits = sideLimits(market, 'quote')
  const baseLimits = sideLimits(market, 'base')
  const relays = market.transports?.nostr?.relays
  if (!quoteLimits || !baseLimits || !Array.isArray(relays) || relays.length === 0) return undefined
  return {
    network,
    pubkey: market.discovery_pubkey!,
    relays: [...relays],
    minSats: Number(quoteLimits.min),
    maxSats: Number(quoteLimits.max),
    maxFundingSats: Number(baseLimits.max),
    market,
  }
}

/** Package-native exact-out ceiling with the card's whole-sat rounding. */
export function vaultLightningFundingForInvoice(invoiceSats: number, profile: VaultLightningSolverProfile): number {
  if (!Number.isSafeInteger(invoiceSats) || invoiceSats < 1) throw new Error('Lightning invoice amount is invalid.')
  const plan = planOffer({
    market: profile.market,
    give: 'base',
    wantAmount: BigInt(invoiceSats),
    safetyBps: 0,
  })
  if (!plan.limits.withinLimits) throw new Error('Lightning amount is outside the solver market limits.')
  if (plan.deposit.atomic > BigInt(profile.maxFundingSats)) {
    throw new Error('Lightning funding amount is outside the solver market limits.')
  }
  return Number(plan.deposit.atomic)
}

export function vaultLightningSendEnabled(
  network: NetworkName | undefined,
  value = import.meta.env.VITE_VAULT_LIGHTNING_SEND,
): boolean {
  return (
    value === LIGHTNING_SEND_RELEASE_FLAG && network !== undefined && vaultLightningSolverProfile(network) !== undefined
  )
}

export function isVaultLightningInput(value: string): boolean {
  return /^ln(?:bc|tb|tbs|bcrt)\d/i.test(value.trim().replace(/^lightning:/i, ''))
}

export function vaultLightningSolverProfile(network: NetworkName): VaultLightningSolverProfile | undefined {
  return network === 'mutinynet' ? MUTINYNET_LIGHTNING_SOLVER : undefined
}

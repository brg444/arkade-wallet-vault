import type { NetworkName } from '@arkade-os/sdk'
import { discover, planOffer, sideLimits, type LocalCardInput, type Market } from '@arkade-os/solver-discovery'
import bitcoinSolverCard from './ln-solver-bitcoin.card.json'
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
const BITCOIN_LIGHTNING_MARKET = bitcoinSolverCard.markets[0] as unknown as Market

/** Guardian says mainnet; the SDK Lightning surface says bitcoin. */
export function lightningSdkNetwork(network: string | undefined): NetworkName | undefined {
  if (network === 'bitcoin' || network === 'mainnet') return 'bitcoin'
  if (network === 'mutinynet') return 'mutinynet'
  return undefined
}

function fundingCeilingSats(market: Market, maxQuoteSats: number): number {
  const plan = planOffer({
    market,
    give: 'base',
    wantAmount: BigInt(maxQuoteSats),
    safetyBps: 0,
  })
  return Number(plan.deposit.atomic)
}

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

/** Official mainnet preview solver. Receive remains closed (max_base_amount 0). */
export const BITCOIN_LIGHTNING_SOLVER: VaultLightningSolverProfile = {
  network: 'bitcoin',
  pubkey: '66422c952f8dcb96e4d0c3f049cd1e265b8461b916d9913c65c2494b64b4e3ce',
  relays: ['wss://nostr.arkade.sh'],
  minSats: 500,
  maxSats: 50_000,
  maxFundingSats: fundingCeilingSats(BITCOIN_LIGHTNING_MARKET, 50_000),
  market: BITCOIN_LIGHTNING_MARKET,
}

const MUTINYNET_LIGHTNING_CARD: LocalCardInput = {
  card: mutinynetSolverCard,
  network: 'mutinynet',
  label: 'bundled:ln-solver-mutinynet',
}

const BITCOIN_LIGHTNING_CARD: LocalCardInput = {
  card: bitcoinSolverCard,
  network: 'bitcoin',
  label: 'bundled:ln-solver-bitcoin',
}

const LIGHTNING_CARDS: Record<'mutinynet' | 'bitcoin', { card: LocalCardInput; expectedPub: string }> = {
  mutinynet: { card: MUTINYNET_LIGHTNING_CARD, expectedPub: MUTINYNET_LIGHTNING_SOLVER.pubkey },
  bitcoin: { card: BITCOIN_LIGHTNING_CARD, expectedPub: BITCOIN_LIGHTNING_SOLVER.pubkey },
}

/**
 * Validate the release-pinned solver card through the same discovery package
 * used by the official wallet, then project only the Lightning-send market.
 * No registry is followed here: a network response cannot redirect Vault
 * funding to a different solver or relay.
 */
export async function discoverVaultLightningSolver(
  network: string,
): Promise<VaultLightningSolverProfile | undefined> {
  const sdkNetwork = lightningSdkNetwork(network)
  if (!sdkNetwork || (sdkNetwork !== 'mutinynet' && sdkNetwork !== 'bitcoin')) return undefined
  const pinned = LIGHTNING_CARDS[sdkNetwork]
  const { markets, sources } = await discover({
    network: sdkNetwork,
    registries: [],
    localCards: [pinned.card],
  })
  if (!sources.some((source) => source.ok && source.source === pinned.card.label)) return undefined
  const market = markets.find(
    (candidate) =>
      candidate.quote_corridor === 'lightning' &&
      candidate.base_asset.id === 'btc' &&
      candidate.quote_asset.id === 'btc' &&
      candidate.discovery_pubkey === pinned.expectedPub,
  )
  if (!market) return undefined
  const quoteLimits = sideLimits(market, 'quote')
  const baseLimits = sideLimits(market, 'base')
  const relays = market.transports?.nostr?.relays
  if (!quoteLimits || !Array.isArray(relays) || relays.length === 0) return undefined
  const maxSats = Number(quoteLimits.max)
  const advertisedBaseMax = baseLimits ? Number(baseLimits.max) : 0
  const maxFundingSats =
    advertisedBaseMax > 0 ? advertisedBaseMax : fundingCeilingSats(market, maxSats)
  if (!Number.isSafeInteger(maxFundingSats) || maxFundingSats < maxSats) return undefined
  return {
    network: sdkNetwork,
    pubkey: market.discovery_pubkey!,
    relays: [...relays],
    minSats: Number(quoteLimits.min),
    maxSats,
    maxFundingSats,
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
  network: string | undefined,
  value = import.meta.env.VITE_VAULT_LIGHTNING_SEND,
): boolean {
  return value === LIGHTNING_SEND_RELEASE_FLAG && vaultLightningSolverProfile(network) !== undefined
}

export function isVaultLightningInput(value: string): boolean {
  return /^ln(?:bc|tb|tbs|bcrt)\d/i.test(value.trim().replace(/^lightning:/i, ''))
}

export function vaultLightningSolverProfile(network: string | undefined): VaultLightningSolverProfile | undefined {
  const sdkNetwork = lightningSdkNetwork(network)
  if (sdkNetwork === 'mutinynet') return MUTINYNET_LIGHTNING_SOLVER
  if (sdkNetwork === 'bitcoin') return BITCOIN_LIGHTNING_SOLVER
  return undefined
}

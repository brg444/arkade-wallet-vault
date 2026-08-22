import { hex } from '@scure/base'
import { applyLocalReplay } from './replayStore'
import { selectRoute } from './route'
import { deriveSession } from './session'
import {
  buildClaimPsbt,
  buildClawbackPsbt,
  buildInitiatePsbt,
  type VaultProgramCoin,
  type VaultProgramFamily,
} from './spend'
import { pendingDelay, pendingGuardians } from './trees'
import type { Claimant, VaultKind } from './constants'

export function planInitiate(input: {
  family: VaultProgramFamily
  kind: VaultKind
  claimant: Claimant
  coin: VaultProgramCoin
  feeSats: number
  vaultId: string
  storage?: Storage
}) {
  selectRoute({ role: 'normal', kind: input.kind }, { type: 'initiate', claimant: input.claimant })
  const built = buildInitiatePsbt({
    family: input.family,
    kind: input.kind,
    claimant: input.claimant,
    coin: input.coin,
    feeSats: input.feeSats,
  })
  applyLocalReplay(
    input.vaultId,
    {
      vaultId: input.vaultId,
      purpose: 'initiate',
      inputTxid: input.coin.txid,
      inputVout: input.coin.vout,
      destScriptHex: scriptHex(input.family.pending[`${input.kind}-${input.claimant}`].script),
    },
    input.storage,
  )
  return built
}

function scriptHex(script: Uint8Array | string): string {
  return (typeof script === 'string' ? script : hex.encode(script)).toLowerCase()
}

export function planClawback(input: {
  family: VaultProgramFamily
  kind: VaultKind
  claimant: Claimant
  guardian?: Claimant
  coin: VaultProgramCoin
  feeSats: number
  vaultId: string
  storage?: Storage
}) {
  const guardian = input.guardian || pendingGuardians(input.claimant)[0]
  selectRoute({ role: 'pending', kind: input.kind, claimant: input.claimant }, { type: 'clawback', guardian })
  const built = buildClawbackPsbt({
    family: input.family,
    kind: input.kind,
    claimant: input.claimant,
    guardian,
    coin: input.coin,
    feeSats: input.feeSats,
  })
  applyLocalReplay(
    input.vaultId,
    {
      vaultId: input.vaultId,
      purpose: 'clawback',
      inputTxid: input.coin.txid,
      inputVout: input.coin.vout,
      destScriptHex: scriptHex(input.family.quarantine[`${input.kind}-${input.claimant}`].script),
    },
    input.storage,
  )
  return { ...built, guardian }
}

export function planClaim(input: {
  family: VaultProgramFamily
  kind: VaultKind
  claimant: Claimant
  coin: VaultProgramCoin
  destAddress: string
  feeSats: number
  network: string
  tipHeight?: number
  confirmedHeight?: number
}) {
  selectRoute(
    { role: 'pending', kind: input.kind, claimant: input.claimant },
    { type: 'claim' },
    { tipHeight: input.tipHeight, confirmedHeight: input.confirmedHeight },
  )
  return buildClaimPsbt({
    family: input.family,
    kind: input.kind,
    claimant: input.claimant,
    coin: input.coin,
    destAddress: input.destAddress,
    feeSats: input.feeSats,
    network: input.network,
  })
}

export function pendingClaimable(claimant: Claimant, tipHeight: number, confirmedHeight: number): boolean {
  return deriveSession(pendingDelay(claimant), {
    tipHeight,
    pending: { txid: '00', vout: 0, value: 0, confirmed: true, blockHeight: confirmedHeight },
  }).claimable
}

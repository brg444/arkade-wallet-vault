import { hex } from '@scure/base'
import { p2tr } from '@scure/btc-signer'
import { vaultAddressNetwork } from '../bitcoin'
import { TAPROOT_NUMS_XONLY, checksigScript, csvChecksigScript, xOnlyFromCompressed } from '../savingsTree'
import { UNSAFE_GENERATOR_2G, UNSAFE_GENERATOR_G } from '../setupPlan'
import { type Claimant, type VaultKind, V5_CSV } from './constants'
import { contextInternalKey } from './context'
import { buildTransitionScript } from './script'

export type TreeRole = 'quarantine' | 'pending' | 'normal'

export function quarantineGuardians(
  claimant: Claimant,
): ['hardware', 'recovery'] | ['phone', 'recovery'] | ['phone', 'hardware'] {
  if (claimant === 'phone') return ['hardware', 'recovery']
  if (claimant === 'hardware') return ['phone', 'recovery']
  return ['phone', 'hardware']
}

export function pendingGuardians(claimant: Claimant): Claimant[] {
  return (['phone', 'hardware', 'recovery'] as const).filter((role) => role !== claimant)
}

export function pendingDelay(claimant: Claimant): number {
  if (claimant === 'hardware') return V5_CSV.hardware
  if (claimant === 'phone') return V5_CSV.phone
  return V5_CSV.recovery
}

type ScriptLeaf = { script: Uint8Array }

/** Pairing matches btcd AssembleTaprootScriptTree. */
export function tapTreeFromScripts(scripts: Uint8Array[]): ScriptLeaf | ScriptLeaf[] {
  if (scripts.length === 0) throw new Error('no leaves')
  if (scripts.length === 1) return { script: scripts[0] }
  const leaves: ScriptLeaf[] = scripts.map((script) => ({ script }))
  const branches: unknown[] = []
  for (let i = 0; i < leaves.length; i += 2) {
    if (i === leaves.length - 1) {
      branches[branches.length - 1] = [branches[branches.length - 1], leaves[i]]
      continue
    }
    branches.push([leaves[i], leaves[i + 1]])
  }
  while (branches.length > 1) {
    const left = branches.shift()
    const right = branches.shift()
    branches.push([left, right])
  }
  return branches[0] as ScriptLeaf[]
}

function requireDistinct(keys: Uint8Array[], name: string) {
  const seen = new Set<string>()
  for (const key of keys) {
    const hexKey = hex.encode(key)
    if (seen.has(hexKey)) throw new Error(`${name} keys must be x-only distinct`)
    seen.add(hexKey)
  }
}

const FORBIDDEN_XONLY = new Set([
  TAPROOT_NUMS_XONLY,
  hex.encode(xOnlyFromCompressed(UNSAFE_GENERATOR_G)),
  hex.encode(xOnlyFromCompressed(UNSAFE_GENERATOR_2G)),
])

function assertFamilyRoles(input: {
  phonePub: string
  hardwarePub: string
  recoveryPub: string
  routineVault: string
  routineArkade: string
  initiate: InitiateTweaks
  pending: InitiateTweaks
}) {
  const pubs = [
    input.phonePub,
    input.hardwarePub,
    input.recoveryPub,
    input.routineVault,
    input.routineArkade,
    input.initiate.phone.vault,
    input.initiate.phone.arkade,
    input.initiate.hardware.vault,
    input.initiate.hardware.arkade,
    input.initiate.recovery.vault,
    input.initiate.recovery.arkade,
    input.pending.phone.vault,
    input.pending.phone.arkade,
    input.pending.hardware.vault,
    input.pending.hardware.arkade,
    input.pending.recovery.vault,
    input.pending.recovery.arkade,
  ].map(xOnlyFromCompressed)
  requireDistinct(pubs, 'family')
  for (const pub of pubs) {
    if (FORBIDDEN_XONLY.has(hex.encode(pub))) throw new Error('family key is a forbidden point')
  }
}

export function buildQuarantine(input: {
  vaultId: string
  kind: VaultKind
  claimant: Claimant
  phonePub: string
  hardwarePub: string
  recoveryPub: string
  network: string
}) {
  const pubs = {
    phone: xOnlyFromCompressed(input.phonePub),
    hardware: xOnlyFromCompressed(input.hardwarePub),
    recovery: xOnlyFromCompressed(input.recoveryPub),
  }
  requireDistinct([pubs.phone, pubs.hardware, pubs.recovery], 'user')
  const [a, b] = quarantineGuardians(input.claimant)
  const script = checksigScript([pubs[a], pubs[b]])
  const internal = contextInternalKey({
    vaultId: input.vaultId,
    kind: input.kind,
    claimant: input.claimant,
  })
  const payment = p2tr(internal, { script }, vaultAddressNetwork(input.network), true)
  if (!payment.address) throw new Error('quarantine address required')
  return {
    role: 'quarantine' as const,
    address: payment.address,
    script: payment.script,
    tapInternalKey: payment.tapInternalKey,
    admin: script,
    guardians: [a, b] as const,
  }
}

export function buildPending(input: {
  vaultId: string
  kind: VaultKind
  claimant: Claimant
  phonePub: string
  hardwarePub: string
  recoveryPub: string
  vaultTweak: string
  arkadeTweak: string
  network: string
}) {
  const pubs = {
    phone: xOnlyFromCompressed(input.phonePub),
    hardware: xOnlyFromCompressed(input.hardwarePub),
    recovery: xOnlyFromCompressed(input.recoveryPub),
  }
  const vault = xOnlyFromCompressed(input.vaultTweak)
  const arkade = xOnlyFromCompressed(input.arkadeTweak)
  requireDistinct([pubs.phone, pubs.hardware, pubs.recovery, vault, arkade], 'pending')
  const claim = csvChecksigScript(pendingDelay(input.claimant), pubs[input.claimant])
  const clawbacks = pendingGuardians(input.claimant).map((guardian) => checksigScript([pubs[guardian], vault, arkade]))
  const scripts = [claim, ...clawbacks]
  const internal = contextInternalKey({
    vaultId: input.vaultId,
    kind: input.kind,
    claimant: input.claimant,
  })
  const payment = p2tr(internal, tapTreeFromScripts(scripts), vaultAddressNetwork(input.network), true)
  if (!payment.address) throw new Error('pending address required')
  return {
    role: 'pending' as const,
    address: payment.address,
    script: payment.script,
    tapInternalKey: payment.tapInternalKey,
    claim,
    clawbacks,
    delay: pendingDelay(input.claimant),
  }
}

export type InitiateTweaks = Record<Claimant, { vault: string; arkade: string }>

export function buildNormal(input: {
  vaultId: string
  kind: VaultKind
  phonePub: string
  hardwarePub: string
  recoveryPub: string
  routineVault?: string
  routineArkade?: string
  initiate: InitiateTweaks
  network: string
}) {
  const phone = xOnlyFromCompressed(input.phonePub)
  const hardware = xOnlyFromCompressed(input.hardwarePub)
  const recovery = xOnlyFromCompressed(input.recoveryPub)
  const tweaks: Uint8Array[] = []
  for (const claimant of ['phone', 'hardware', 'recovery'] as const) {
    tweaks.push(
      xOnlyFromCompressed(input.initiate[claimant].vault),
      xOnlyFromCompressed(input.initiate[claimant].arkade),
    )
  }
  if (input.kind === 'daily') {
    if (!input.routineVault || !input.routineArkade) throw new Error('daily routine tweaks required')
    tweaks.push(xOnlyFromCompressed(input.routineVault), xOnlyFromCompressed(input.routineArkade))
  } else if (input.routineVault || input.routineArkade) {
    throw new Error('savings must not include routine tweaks')
  }
  requireDistinct([phone, hardware, recovery, ...tweaks], 'normal')

  const admin = checksigScript([phone, hardware])
  const initiate = (['phone', 'hardware', 'recovery'] as const).map((claimant) =>
    checksigScript([
      { phone, hardware, recovery }[claimant],
      xOnlyFromCompressed(input.initiate[claimant].vault),
      xOnlyFromCompressed(input.initiate[claimant].arkade),
    ]),
  )
  const scripts =
    input.kind === 'daily'
      ? [
          checksigScript([phone, xOnlyFromCompressed(input.routineVault!), xOnlyFromCompressed(input.routineArkade!)]),
          admin,
          ...initiate,
        ]
      : [admin, ...initiate]

  const internal = contextInternalKey({ vaultId: input.vaultId, kind: input.kind, claimant: '' })
  const payment = p2tr(internal, tapTreeFromScripts(scripts), vaultAddressNetwork(input.network), true)
  if (!payment.address) throw new Error('normal address required')
  return {
    role: 'normal' as const,
    kind: input.kind,
    address: payment.address,
    script: payment.script,
    tapInternalKey: payment.tapInternalKey,
    admin,
    initiate,
    routine: input.kind === 'daily' ? scripts[0] : undefined,
  }
}

export function buildV5Family(input: {
  vaultId: string
  phonePub: string
  hardwarePub: string
  recoveryPub: string
  routineVault: string
  routineArkade: string
  initiate: InitiateTweaks
  pending: InitiateTweaks
  network: string
}) {
  assertFamilyRoles(input)
  const kinds = ['daily', 'savings'] as const
  const claimants = ['phone', 'hardware', 'recovery'] as const
  const quarantine = {} as Record<`${(typeof kinds)[number]}-${Claimant}`, ReturnType<typeof buildQuarantine>>
  const pending = {} as Record<`${(typeof kinds)[number]}-${Claimant}`, ReturnType<typeof buildPending>>
  const initiateAuth = {} as Record<`${(typeof kinds)[number]}-${Claimant}`, Uint8Array>
  const clawbackAuth = {} as Record<`${(typeof kinds)[number]}-${Claimant}`, Uint8Array>
  for (const kind of kinds) {
    for (const claimant of claimants) {
      const key = `${kind}-${claimant}` as const
      quarantine[key] = buildQuarantine({ ...input, kind, claimant })
      pending[key] = buildPending({
        ...input,
        kind,
        claimant,
        vaultTweak: input.pending[claimant].vault,
        arkadeTweak: input.pending[claimant].arkade,
      })
      initiateAuth[key] = buildTransitionScript({ destScriptHex: hex.encode(pending[key].script) })
      clawbackAuth[key] = buildTransitionScript({ destScriptHex: hex.encode(quarantine[key].script) })
    }
  }
  return {
    daily: buildNormal({ ...input, kind: 'daily' }),
    savings: buildNormal({ ...input, kind: 'savings', routineVault: undefined, routineArkade: undefined }),
    quarantine,
    pending,
    initiateAuth,
    clawbackAuth,
  }
}

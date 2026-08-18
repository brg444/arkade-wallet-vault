import { hex } from '@scure/base'
import { p2tr } from '@scure/btc-signer'
import { vaultAddressNetwork } from '../bitcoin'
import { checksigScript, csvChecksigScript, xOnlyFromCompressed } from '../savingsTree'
import { type Claimant, type VaultKind, V5_CSV } from './constants'
import { contextInternalKey } from './context'

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

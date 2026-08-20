import { p256 } from '@noble/curves/nist.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hex } from '@scure/base'
import {
  ABSOLUTE_FEE_CEILING_SATS,
  DUST_SATS,
  FEERATE_CEILING_SAT_PER_V,
  PERIOD_ALLOWANCE_SATS,
  POLICY_VERSION,
  SUPPORTED_NETWORKS,
  TX_RECIPIENT_CAP_SATS,
  type VaultNetwork,
} from '../constants'
import { bytesToHex, encodeUtf8, hexToBytes, requireLowerHex } from '../hex'
import {
  familyClaimants,
  familyKeysFor,
  P2A_OUTPUT_INDEX,
  P2A_SCRIPT_HEX,
  P2A_VALUE_SATS,
  TRANSITION_SEQUENCE,
  V5_CSV,
  V5_SCHEMA,
  isStagedTemplate,
  STAGED_TEMPLATE,
  type Claimant,
  type FamilyKey,
} from './constants'
import { type InitiateTweaks, buildV5Family } from './trees'

const COMPRESSED = 33

export interface V5TreeRef {
  script: string
  address: string
}

export interface V5PublicDescriptor {
  schema: typeof V5_SCHEMA
  network: VaultNetwork
  vaultId: string
  templateVersion: string
  policyVersion: string
  keys: {
    phoneRoutineBip340: string
    phoneDirectP256: string
    hardware: string
    recovery?: string
    vaultCosignerBase: string
    arkadeCosignerBase: string
  }
  tweaks: {
    routine: { vault: string; arkade: string }
    initiate: { daily: InitiateTweaks; savings: InitiateTweaks }
    pending: Record<FamilyKey, { vault: string; arkade: string }>
  }
  arkadeCosigner: {
    origin: string
    version: string
  }
  csv: {
    hardware: number
    phone: number
    recovery: number
  }
  policy: {
    recipientDustSats: number
    recipientCapSats: number
    periodAllowanceSats: number
    absoluteFeeCapSats: number
    feerateCapSatVb: number
  }
  p2a: {
    script: string
    valueSats: number
    outputIndex: number
  }
  transitionSequence: number
  daily: V5TreeRef
  savings: V5TreeRef
  pending: Record<FamilyKey, V5TreeRef & { delay: number }>
  quarantine: Record<FamilyKey, V5TreeRef & { guardians: readonly string[] }>
}

export interface V5DescriptorInput {
  vaultId: string
  network: VaultNetwork
  phonePub: string
  hardwarePub: string
  recoveryPub?: string
  phoneDirectP256: string
  vaultCosignerBase: string
  arkadeCosignerBase: string
  routineVault: string
  routineArkade: string
  arkadeCosigner: {
    origin: string
    version: string
  }
  templateVersion?: string
}

function appendU32(parts: Uint8Array[], value: number, name: string) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${name} is not a uint32`)
  }
  const buf = new Uint8Array(4)
  new DataView(buf.buffer).setUint32(0, value, false)
  parts.push(buf)
}

function appendI64(parts: Uint8Array[], value: number, name: string) {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${name} is not a safe non-negative integer`)
  }
  const buf = new Uint8Array(8)
  new DataView(buf.buffer).setBigUint64(0, BigInt(value), false)
  parts.push(buf)
}

function appendBytes(parts: Uint8Array[], bytes: Uint8Array) {
  appendU32(parts, bytes.length, 'length')
  parts.push(bytes)
}

function appendHex(parts: Uint8Array[], value: string, name: string, exactBytes: number) {
  appendBytes(parts, hexToBytes(requireLowerHex(value, name, exactBytes)))
}

function appendText(parts: Uint8Array[], value: string, name: string) {
  if (!value || value !== value.trim() || value !== value.toLowerCase()) {
    throw new Error(`${name} must be non-empty canonical lowercase`)
  }
  appendBytes(parts, encodeUtf8(value))
}

function appendRawText(parts: Uint8Array[], value: string, name: string) {
  if (!value || value !== value.trim()) throw new Error(`${name} required`)
  appendBytes(parts, encodeUtf8(value))
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function requireSecp(pub: string, name: string): string {
  const hexKey = requireLowerHex(pub, name, COMPRESSED)
  if (hexKey[1] !== '2' && hexKey[1] !== '3') throw new Error(`${name} must be compressed`)
  if (!secp256k1.utils.isValidPublicKey(hexToBytes(hexKey), true)) {
    throw new Error(`${name} is not a valid secp256k1 public key`)
  }
  return hexKey
}

function requireP256(pub: string, name: string): string {
  const hexKey = requireLowerHex(pub, name, COMPRESSED)
  if (hexKey[0] !== '0' || (hexKey[1] !== '2' && hexKey[1] !== '3')) {
    throw new Error(`${name} must be compressed`)
  }
  if (!p256.utils.isValidPublicKey(hexToBytes(hexKey), true)) {
    throw new Error(`${name} is not a valid P-256 public key`)
  }
  return hexKey
}

function requirePair(pair: { vault: string; arkade: string }, name: string) {
  return {
    vault: requireSecp(pair.vault, `${name}.vault`),
    arkade: requireSecp(pair.arkade, `${name}.arkade`),
  }
}

function treeRef(script: Uint8Array, address: string): V5TreeRef {
  return { script: hex.encode(script), address }
}

export function buildV5Descriptor(input: V5DescriptorInput): V5PublicDescriptor {
  const keys = {
    phoneRoutineBip340: requireSecp(input.phonePub, 'phone'),
    phoneDirectP256: requireP256(input.phoneDirectP256, 'phoneDirectP256'),
    hardware: requireSecp(input.hardwarePub, 'hardware'),
    ...(input.recoveryPub ? { recovery: requireSecp(input.recoveryPub, 'recovery') } : {}),
    vaultCosignerBase: requireSecp(input.vaultCosignerBase, 'vaultCosignerBase'),
    arkadeCosignerBase: requireSecp(input.arkadeCosignerBase, 'arkadeCosignerBase'),
  }
  if (!input.arkadeCosigner.origin.trim() || !input.arkadeCosigner.version.trim()) {
    throw new Error('arkade cosigner origin and version required')
  }
  const family = buildV5Family({
    vaultId: input.vaultId,
    phonePub: keys.phoneRoutineBip340,
    hardwarePub: keys.hardware,
    recoveryPub: keys.recovery,
    phoneDirectP256: keys.phoneDirectP256,
    vaultCosignerBase: keys.vaultCosignerBase,
    arkadeCosignerBase: keys.arkadeCosignerBase,
    routineVault: input.routineVault,
    routineArkade: input.routineArkade,
    network: input.network,
    templateVersion: input.templateVersion || STAGED_TEMPLATE,
  })
  const tweaks = {
    routine: requirePair({ vault: input.routineVault, arkade: input.routineArkade }, 'routine'),
    initiate: family.initiateTweaks,
    pending: family.pendingTweaks,
  }
  const pending = {} as V5PublicDescriptor['pending']
  const quarantine = {} as V5PublicDescriptor['quarantine']
  for (const key of familyKeysFor(Boolean(keys.recovery))) {
    pending[key] = {
      ...treeRef(family.pending[key].script, family.pending[key].address),
      delay: family.pending[key].delay,
    }
    quarantine[key] = {
      ...treeRef(family.quarantine[key].script, family.quarantine[key].address),
      guardians: family.quarantine[key].guardians,
    }
  }
  return validateV5Descriptor({
    schema: V5_SCHEMA,
    network: input.network,
    vaultId: input.vaultId,
    templateVersion: input.templateVersion || STAGED_TEMPLATE,
    policyVersion: POLICY_VERSION,
    keys,
    tweaks,
    arkadeCosigner: {
      origin: input.arkadeCosigner.origin.trim(),
      version: input.arkadeCosigner.version.trim(),
    },
    csv: { ...V5_CSV },
    policy: {
      recipientDustSats: DUST_SATS,
      recipientCapSats: TX_RECIPIENT_CAP_SATS,
      periodAllowanceSats: PERIOD_ALLOWANCE_SATS,
      absoluteFeeCapSats: ABSOLUTE_FEE_CEILING_SATS,
      feerateCapSatVb: FEERATE_CEILING_SAT_PER_V,
    },
    p2a: {
      script: P2A_SCRIPT_HEX,
      valueSats: P2A_VALUE_SATS,
      outputIndex: P2A_OUTPUT_INDEX,
    },
    transitionSequence: TRANSITION_SEQUENCE,
    daily: treeRef(family.daily.script, family.daily.address),
    savings: treeRef(family.savings.script, family.savings.address),
    pending,
    quarantine,
  })
}

export function validateV5Descriptor(d: V5PublicDescriptor): V5PublicDescriptor {
  if (d.schema !== V5_SCHEMA) throw new Error('unsupported vault schema')
  if (!SUPPORTED_NETWORKS.includes(d.network)) throw new Error(`unsupported network ${d.network}`)
  if (!d.vaultId || String(d.vaultId).trim() === '') throw new Error('vault id required')
  if (!isStagedTemplate(d.templateVersion)) throw new Error('template version is not this release')
  if (d.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  if (d.csv.hardware !== V5_CSV.hardware || d.csv.phone !== V5_CSV.phone || d.csv.recovery !== V5_CSV.recovery) {
    throw new Error('csv delays do not match this release')
  }
  if (d.p2a.script !== P2A_SCRIPT_HEX || d.p2a.valueSats !== P2A_VALUE_SATS || d.p2a.outputIndex !== P2A_OUTPUT_INDEX) {
    throw new Error('P2A lock does not match this release')
  }
  if (d.transitionSequence !== TRANSITION_SEQUENCE) throw new Error('transition sequence does not match this release')
  if (d.policy.recipientDustSats !== DUST_SATS) throw new Error('dust does not match this release')
  if (d.policy.recipientCapSats !== TX_RECIPIENT_CAP_SATS) throw new Error('tx cap does not match this release')
  if (d.policy.periodAllowanceSats !== PERIOD_ALLOWANCE_SATS)
    throw new Error('period allowance does not match this release')
  if (d.policy.absoluteFeeCapSats !== ABSOLUTE_FEE_CEILING_SATS) throw new Error('fee cap does not match this release')
  if (d.policy.feerateCapSatVb !== FEERATE_CEILING_SAT_PER_V) throw new Error('feerate cap does not match this release')
  requireSecp(d.keys.phoneRoutineBip340, 'phone')
  requireP256(d.keys.phoneDirectP256, 'phoneDirectP256')
  requireSecp(d.keys.hardware, 'hardware')
  if (d.keys.recovery) requireSecp(d.keys.recovery, 'recovery')
  requireSecp(d.keys.vaultCosignerBase, 'vaultCosignerBase')
  requireSecp(d.keys.arkadeCosignerBase, 'arkadeCosignerBase')
  requirePair(d.tweaks.routine, 'routine')
  const hasRecovery = Boolean(d.keys.recovery)
  const claimants = familyClaimants(hasRecovery)
  const keys = familyKeysFor(hasRecovery)
  for (const claimant of claimants) {
    requirePair(d.tweaks.initiate.daily[claimant]!, `initiate.daily.${claimant}`)
    requirePair(d.tweaks.initiate.savings[claimant]!, `initiate.savings.${claimant}`)
  }
  for (const key of keys) {
    requirePair(d.tweaks.pending[key], `pending.${key}`)
  }
  const rebuilt = buildV5Family({
    vaultId: d.vaultId,
    phonePub: d.keys.phoneRoutineBip340,
    hardwarePub: d.keys.hardware,
    recoveryPub: d.keys.recovery,
    phoneDirectP256: d.keys.phoneDirectP256,
    vaultCosignerBase: d.keys.vaultCosignerBase,
    arkadeCosignerBase: d.keys.arkadeCosignerBase,
    routineVault: d.tweaks.routine.vault,
    routineArkade: d.tweaks.routine.arkade,
    network: d.network,
    templateVersion: d.templateVersion,
  })
  for (const claimant of claimants) {
    if (
      d.tweaks.initiate.daily[claimant]!.vault !== rebuilt.initiateTweaks.daily[claimant]!.vault ||
      d.tweaks.initiate.daily[claimant]!.arkade !== rebuilt.initiateTweaks.daily[claimant]!.arkade ||
      d.tweaks.initiate.savings[claimant]!.vault !== rebuilt.initiateTweaks.savings[claimant]!.vault ||
      d.tweaks.initiate.savings[claimant]!.arkade !== rebuilt.initiateTweaks.savings[claimant]!.arkade
    ) {
      throw new Error('initiate tweaks do not match derived authorization scripts')
    }
  }
  for (const key of keys) {
    if (
      d.tweaks.pending[key].vault !== rebuilt.pendingTweaks[key].vault ||
      d.tweaks.pending[key].arkade !== rebuilt.pendingTweaks[key].arkade
    ) {
      throw new Error('pending tweaks do not match derived authorization scripts')
    }
  }
  if (d.daily.address !== rebuilt.daily.address || d.daily.script !== hex.encode(rebuilt.daily.script)) {
    throw new Error('daily tree does not match rebuilt descriptor')
  }
  if (d.savings.address !== rebuilt.savings.address || d.savings.script !== hex.encode(rebuilt.savings.script)) {
    throw new Error('savings tree does not match rebuilt descriptor')
  }
  for (const key of keys) {
    if (!d.pending[key] || !d.quarantine[key]) throw new Error(`missing ${key} trees`)
    if (d.pending[key].address !== rebuilt.pending[key].address)
      throw new Error(`${key} pending does not match rebuilt descriptor`)
    if (d.pending[key].script !== hex.encode(rebuilt.pending[key].script)) {
      throw new Error(`${key} pending does not match rebuilt descriptor`)
    }
    if (d.pending[key].delay !== rebuilt.pending[key].delay) throw new Error(`${key} pending delay does not match`)
    if (d.quarantine[key].address !== rebuilt.quarantine[key].address) {
      throw new Error(`${key} quarantine does not match rebuilt descriptor`)
    }
    if (d.quarantine[key].script !== hex.encode(rebuilt.quarantine[key].script)) {
      throw new Error(`${key} quarantine does not match rebuilt descriptor`)
    }
    const want = rebuilt.quarantine[key].guardians
    if (
      d.quarantine[key].guardians.length !== want.length ||
      d.quarantine[key].guardians.some((g, i) => g !== want[i])
    ) {
      throw new Error(`${key} quarantine guardians do not match`)
    }
  }
  return d
}

export function encodeV5Descriptor(input: V5PublicDescriptor): Uint8Array {
  const d = validateV5Descriptor(input)
  const parts: Uint8Array[] = []
  appendText(parts, d.schema, 'schema')
  appendText(parts, d.network, 'network')
  appendText(parts, d.vaultId, 'vaultId')
  appendBytes(parts, encodeUtf8(d.templateVersion))
  appendBytes(parts, encodeUtf8(d.policyVersion))
  appendHex(parts, d.keys.phoneRoutineBip340, 'phone', COMPRESSED)
  appendHex(parts, d.keys.phoneDirectP256, 'phoneDirectP256', COMPRESSED)
  appendHex(parts, d.keys.hardware, 'hardware', COMPRESSED)
  if (d.keys.recovery) appendHex(parts, d.keys.recovery, 'recovery', COMPRESSED)
  appendHex(parts, d.keys.vaultCosignerBase, 'vaultCosignerBase', COMPRESSED)
  appendHex(parts, d.keys.arkadeCosignerBase, 'arkadeCosignerBase', COMPRESSED)
  appendHex(parts, d.tweaks.routine.vault, 'routine.vault', COMPRESSED)
  appendHex(parts, d.tweaks.routine.arkade, 'routine.arkade', COMPRESSED)
  const hasRecovery = Boolean(d.keys.recovery)
  for (const kind of ['daily', 'savings'] as const) {
    for (const claimant of familyClaimants(hasRecovery)) {
      appendHex(parts, d.tweaks.initiate[kind][claimant]!.vault, `initiate.${kind}.${claimant}.vault`, COMPRESSED)
      appendHex(parts, d.tweaks.initiate[kind][claimant]!.arkade, `initiate.${kind}.${claimant}.arkade`, COMPRESSED)
    }
  }
  for (const key of familyKeysFor(hasRecovery)) {
    appendHex(parts, d.tweaks.pending[key].vault, `pending.${key}.vault`, COMPRESSED)
    appendHex(parts, d.tweaks.pending[key].arkade, `pending.${key}.arkade`, COMPRESSED)
  }
  appendRawText(parts, d.arkadeCosigner.origin, 'arkade origin')
  appendRawText(parts, d.arkadeCosigner.version, 'arkade version')
  appendU32(parts, d.csv.hardware, 'csv.hardware')
  appendU32(parts, d.csv.phone, 'csv.phone')
  appendU32(parts, d.csv.recovery, 'csv.recovery')
  appendI64(parts, d.policy.recipientDustSats, 'dust')
  appendI64(parts, d.policy.recipientCapSats, 'tx cap')
  appendI64(parts, d.policy.periodAllowanceSats, 'period')
  appendI64(parts, d.policy.absoluteFeeCapSats, 'fee cap')
  appendI64(parts, d.policy.feerateCapSatVb, 'feerate')
  appendHex(parts, d.p2a.script, 'p2a.script', d.p2a.script.length / 2)
  appendI64(parts, d.p2a.valueSats, 'p2a.value')
  appendU32(parts, d.p2a.outputIndex, 'p2a.index')
  appendU32(parts, d.transitionSequence, 'sequence')
  appendHex(parts, d.daily.script, 'daily.script', d.daily.script.length / 2)
  appendText(parts, d.daily.address, 'daily.address')
  appendHex(parts, d.savings.script, 'savings.script', d.savings.script.length / 2)
  appendText(parts, d.savings.address, 'savings.address')
  for (const key of familyKeysFor(hasRecovery)) {
    appendHex(parts, d.pending[key].script, `${key}.pending.script`, d.pending[key].script.length / 2)
    appendText(parts, d.pending[key].address, `${key}.pending.address`)
    appendU32(parts, d.pending[key].delay, `${key}.pending.delay`)
  }
  for (const key of familyKeysFor(hasRecovery)) {
    appendHex(parts, d.quarantine[key].script, `${key}.quarantine.script`, d.quarantine[key].script.length / 2)
    appendText(parts, d.quarantine[key].address, `${key}.quarantine.address`)
    appendText(parts, d.quarantine[key].guardians[0], `${key}.guardian0`)
    if (d.quarantine[key].guardians[1]) {
      appendText(parts, d.quarantine[key].guardians[1], `${key}.guardian1`)
    }
  }
  return concat(parts)
}

export function hashV5Descriptor(d: V5PublicDescriptor): string {
  return bytesToHex(sha256(encodeV5Descriptor(d)))
}

export function familyFromDescriptor(d: V5PublicDescriptor) {
  const valid = validateV5Descriptor(d)
  return buildV5Family({
    vaultId: valid.vaultId,
    phonePub: valid.keys.phoneRoutineBip340,
    hardwarePub: valid.keys.hardware,
    recoveryPub: valid.keys.recovery,
    phoneDirectP256: valid.keys.phoneDirectP256,
    vaultCosignerBase: valid.keys.vaultCosignerBase,
    arkadeCosignerBase: valid.keys.arkadeCosignerBase,
    routineVault: valid.tweaks.routine.vault,
    routineArkade: valid.tweaks.routine.arkade,
    network: valid.network,
    templateVersion: valid.templateVersion,
  })
}

export type { Claimant, FamilyKey }

import { sha256 } from '@noble/hashes/sha2.js'
import {
  ABSOLUTE_FEE_CEILING_SATS,
  DUST_SATS,
  FEERATE_CEILING_SAT_PER_V,
  PERIOD_ALLOWANCE_SATS,
  POLICY_VERSION,
  SUPPORTED_NETWORKS,
  TEMPLATE_VERSION,
  TX_RECIPIENT_CAP_SATS,
  VAULT_ID,
  VAULT_SCHEMA,
  type VaultNetwork,
} from './constants'
import { bytesToHex, encodeUtf8, hexToBytes, requireLowerHex } from './hex'
import type { VaultPublicDescriptor, VaultStatus } from './types'

const COMPRESSED = 33
const XONLY = 32

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

function appendHex(parts: Uint8Array[], hex: string, name: string, exactBytes: number) {
  appendBytes(parts, hexToBytes(requireLowerHex(hex, name, exactBytes)))
}

function appendText(parts: Uint8Array[], value: string, name: string) {
  if (!value || value !== value.trim() || value !== value.toLowerCase()) {
    throw new Error(`${name} must be non-empty canonical lowercase`)
  }
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

export function validateDescriptor(d: VaultPublicDescriptor): VaultPublicDescriptor {
  if (d.schema !== VAULT_SCHEMA) throw new Error('unsupported vault schema')
  if (!SUPPORTED_NETWORKS.includes(d.network)) throw new Error(`unsupported network ${d.network}`)
  if (d.vaultId !== VAULT_ID) throw new Error('unexpected vault id')
  if (d.templateVersion !== TEMPLATE_VERSION) throw new Error('template version is not this release')
  if (d.policyVersion !== POLICY_VERSION) throw new Error('policy version is not this release')
  if (d.policy.recipientDustSats !== DUST_SATS) throw new Error('dust does not match this release')
  if (d.policy.recipientCapSats !== TX_RECIPIENT_CAP_SATS) throw new Error('tx cap does not match this release')
  if (d.policy.periodAllowanceSats !== PERIOD_ALLOWANCE_SATS) throw new Error('period allowance does not match this release')
  if (d.policy.absoluteFeeCapSats !== ABSOLUTE_FEE_CEILING_SATS) throw new Error('fee cap does not match this release')
  if (d.policy.feerateCapSatVb !== FEERATE_CEILING_SAT_PER_V) throw new Error('feerate cap does not match this release')
  if (!d.savings.excludesRoutineCosigners) throw new Error('savings must exclude routine cosigners')
  if (!d.operational.address || !d.savings.address) throw new Error('vault addresses required')
  if (d.csv.operationalBlocks < 1 || d.csv.savingsBlocks < 1) throw new Error('csv delays required')
  requireLowerHex(d.keys.phoneRoutineBip340, 'phoneRoutineBip340', COMPRESSED)
  requireLowerHex(d.keys.phoneDirectP256, 'phoneDirectP256', COMPRESSED)
  requireLowerHex(d.keys.externalOwnerWallet, 'externalOwnerWallet', COMPRESSED)
  requireLowerHex(d.keys.recoveryKey, 'recoveryKey', COMPRESSED)
  requireLowerHex(d.keys.vaultCosignerBase, 'vaultCosignerBase', COMPRESSED)
  requireLowerHex(d.keys.arkadeCosignerBase, 'arkadeCosignerBase', COMPRESSED)
  requireLowerHex(d.keys.tweakedVaultCosigner, 'tweakedVaultCosigner', XONLY)
  requireLowerHex(d.keys.tweakedArkadeCosigner, 'tweakedArkadeCosigner', XONLY)
  requireLowerHex(d.operational.script, 'operational.script')
  requireLowerHex(d.savings.script, 'savings.script')
  return d
}

// encodeDescriptor is the v3 public-descriptor digest input. Field order is the
// protocol; do not JSON.stringify this object for hashing.
export function encodeDescriptor(input: VaultPublicDescriptor): Uint8Array {
  const d = validateDescriptor(input)
  const parts: Uint8Array[] = []
  appendText(parts, d.schema, 'schema')
  appendText(parts, d.network, 'network')
  appendText(parts, d.vaultId, 'vaultId')
  appendBytes(parts, encodeUtf8(d.templateVersion))
  appendBytes(parts, encodeUtf8(d.policyVersion))
  appendHex(parts, d.keys.phoneRoutineBip340, 'phoneRoutineBip340', COMPRESSED)
  appendHex(parts, d.keys.phoneDirectP256, 'phoneDirectP256', COMPRESSED)
  appendHex(parts, d.keys.externalOwnerWallet, 'externalOwnerWallet', COMPRESSED)
  appendHex(parts, d.keys.recoveryKey, 'recoveryKey', COMPRESSED)
  appendHex(parts, d.keys.vaultCosignerBase, 'vaultCosignerBase', COMPRESSED)
  appendHex(parts, d.keys.tweakedVaultCosigner, 'tweakedVaultCosigner', XONLY)
  appendHex(parts, d.keys.arkadeCosignerBase, 'arkadeCosignerBase', COMPRESSED)
  appendHex(parts, d.keys.tweakedArkadeCosigner, 'tweakedArkadeCosigner', XONLY)
  appendBytes(parts, encodeUtf8(d.arkadeCosigner.origin))
  appendBytes(parts, encodeUtf8(d.arkadeCosigner.version))
  appendU32(parts, d.csv.operationalBlocks, 'operational csv')
  appendU32(parts, d.csv.savingsBlocks, 'savings csv')
  appendI64(parts, d.policy.recipientDustSats, 'dust')
  appendI64(parts, d.policy.recipientCapSats, 'tx cap')
  appendI64(parts, d.policy.periodAllowanceSats, 'period')
  appendI64(parts, d.policy.absoluteFeeCapSats, 'fee cap')
  appendI64(parts, d.policy.feerateCapSatVb, 'feerate')
  appendHex(parts, d.operational.script, 'operational.script', d.operational.script.length / 2)
  appendBytes(parts, encodeUtf8(d.operational.address))
  appendHex(parts, d.savings.script, 'savings.script', d.savings.script.length / 2)
  appendBytes(parts, encodeUtf8(d.savings.address))
  parts.push(new Uint8Array([d.savings.excludesRoutineCosigners ? 1 : 0]))
  return concat(parts)
}

export function hashDescriptor(d: VaultPublicDescriptor): string {
  return bytesToHex(sha256(encodeDescriptor(d)))
}

function descriptorFieldsFromStatus(status: VaultStatus, savingsScript: string): VaultPublicDescriptor {
  if (!status.enrolled) throw new Error('authorizer is not enrolled')
  const network = status.network as VaultNetwork
  return {
    schema: VAULT_SCHEMA,
    network,
    vaultId: status.vaultId,
    templateVersion: status.templateVersion,
    policyVersion: status.policyVersion,
    keys: {
      phoneRoutineBip340: status.phoneRoutineBip340Pub || '',
      phoneDirectP256: status.phoneDirectP256 || '',
      externalOwnerWallet: status.externalOwnerWalletPub || '',
      recoveryKey: status.recoveryKeyPub || '',
      vaultCosignerBase: status.vaultCosignerBasePub || '',
      tweakedVaultCosigner: status.tweakedVaultCosignerXOnly || '',
      arkadeCosignerBase: status.arkadeCosignerBasePub || '',
      tweakedArkadeCosigner: status.tweakedArkadeCosignerXOnly || '',
    },
    arkadeCosigner: {
      origin: status.arkadeCosignerOrigin || '',
      version: status.arkadeCosignerVersion || '',
    },
    csv: {
      operationalBlocks: status.operationalCsvBlocks,
      savingsBlocks: status.savingsCsvBlocks,
    },
    policy: {
      recipientDustSats: DUST_SATS,
      recipientCapSats: status.txCap,
      periodAllowanceSats: status.periodAllowance,
      absoluteFeeCapSats: status.absoluteFeeCap,
      feerateCapSatVb: status.feerateCapSatVb,
    },
    operational: {
      script: status.operationalScript || '',
      address: status.operationalAddress,
    },
    savings: {
      script: savingsScript,
      address: status.savingsAddress,
      excludesRoutineCosigners: status.savingsExcludesRoutineCosigners,
    },
  }
}

// /v1/status does not return the Savings script, so a hashed v3 descriptor
// cannot be built from status alone.
export function descriptorFromStatusWithSavingsScript(
  status: VaultStatus,
  savingsScript: string,
): VaultPublicDescriptor {
  return validateDescriptor(descriptorFieldsFromStatus(status, requireLowerHex(savingsScript, 'savings.script')))
}

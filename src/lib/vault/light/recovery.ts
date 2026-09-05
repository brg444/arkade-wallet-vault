import { requireReleaseNetwork } from '../releaseNetwork'
import { isVaultBitcoinAddress } from '../bitcoin'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import {
  ArkAddress,
  EsploraProvider,
  InMemoryContractRepository,
  InMemoryWalletRepository,
  OnchainWallet,
  RestIndexerProvider,
  SingleKey,
  UnilateralExit,
  Wallet,
  serializeExitPackage,
  deserializeExitPackage,
  type ExitPackage,
  type ExecutorEvent,
} from '@arkade-os/sdk'
import { lightContract, registerLightContractHandler } from './contractHandler'
import { LightScript, lightDescriptorDigest } from './contract'
import { lightStatusMatchesDescriptor } from './status'
import { validateLightEnrollment, type LightEnrollment } from './enrollment'
import { unlockLightOwnerKey } from './keyBackup'
import { unlockPhoneBip340 } from '../savingsSpend'
import { vaultArkServer } from '../vtxo/spend'
import { networkPins, sdkNetworkName } from '../networkPins'
import type { VaultStatus } from '../types'
import { hex } from '@scure/base'

export interface LightRecoveryFile extends LightEnrollment {
  name: 'vaulted-light-recovery'
  version: 1
  createdAt: string
  exitPackage?: ExitPackage
  exitPackageSignature?: string
  feeFundingAddress?: string
}

/** Graph mode signs recovery paths without broadcasting or funding an exit. */
export async function prepareLightRecoveryFile(
  record: LightEnrollment,
  status: VaultStatus,
  recoveryAddress: string,
): Promise<LightRecoveryFile> {
  const valid = validateLightEnrollment(record)
  const bound = lightStatusMatchesDescriptor(status, valid.descriptor)
  const owner = await unlockPhoneBip340(valid.enrollment, bound)
  try {
    return await prepareLightRecoveryWithOwner(valid, owner, recoveryAddress)
  } finally {
    owner.fill(0)
  }
}

export async function prepareLightRecoveryWithSecret(
  record: LightEnrollment,
  secret: string,
  recoveryAddress: string,
): Promise<LightRecoveryFile> {
  const valid = validateLightEnrollment(record)
  if (!/^[0-9a-f]{64}$/.test(secret.trim())) throw new Error('Enter your complete recovery secret')
  const material = hex.decode(secret.trim())
  let owner: Uint8Array | undefined
  try {
    owner = await unlockLightOwnerKey(valid.recoveryBackup, material, 'recovery-secret', valid.descriptor)
    return await prepareLightRecoveryWithOwner(valid, owner, recoveryAddress)
  } finally {
    material.fill(0)
    owner?.fill(0)
  }
}

async function prepareLightRecoveryWithOwner(
  record: LightEnrollment,
  owner: Uint8Array,
  recoveryAddress: string,
): Promise<LightRecoveryFile> {
  if (!isVaultBitcoinAddress(recoveryAddress, record.descriptor.network))
    throw new Error('Enter a Bitcoin recovery address for this network')
  requireReleaseNetwork(record.descriptor.network)
  registerLightContractHandler()
  const network = sdkNetworkName(record.descriptor.network)!
  const identity = SingleKey.fromPrivateKey(owner)
  const onchain = new EsploraProvider('/esplora')
  const onchainWallet = await OnchainWallet.create(identity, network, onchain)
  const walletRepository = new InMemoryWalletRepository()
  const contractRepository = new InMemoryContractRepository()
  const provider = new RestIndexerProvider(vaultArkServer(record.descriptor.network))
  const result = await provider.getVtxos({ scripts: [record.descriptor.scriptPubKey] })
  const coins = result.vtxos.filter((v) => !v.isSpent)
  const file: LightRecoveryFile = {
    name: 'vaulted-light-recovery',
    version: 1,
    createdAt: new Date().toISOString(),
    ...record,
  }
  if (!coins.length) return file
  // The explicit script-filtered set keeps default SDK funds out of recovery.
  const wallet = await Wallet.create({
    identity,
    arkServerUrl: vaultArkServer(record.descriptor.network),
    esploraUrl: '/esplora',
    storage: { walletRepository, contractRepository },
    walletMode: 'static',
    settlementConfig: { boardingUtxoSweep: false, deprecatedSignerMigration: false, autoRenewVtxos: false },
  })
  try {
    const manager = await wallet.getContractManager()
    const script = new LightScript(record.descriptor)
    const address = new ArkAddress(
      hex.decode(record.descriptor.operatorPub),
      script.tweakedPublicKey,
      networkPins(record.descriptor.network).arkHrp,
    ).encode()
    await manager.createContract(lightContract(script, address))
    const options = {
      wallet,
      onchainWallet,
      sweepAddress: recoveryAddress,
      vtxos: coins.map(({ txid, vout }) => ({ txid, vout })),
      mode: 'graph' as const,
      networkName: network,
    }
    const quote = await UnilateralExit.estimate(options)
    if (quote.vtxos.some((v) => v.skipped))
      throw new Error(
        'Some outputs cannot be included in an emergency exit at the current network fee. Keep the recovery file and try again with a larger balance or lower fees.',
      )
    const pkg = await UnilateralExit.prepare(options)
    if (pkg.mode !== 'graph' || pkg.vtxos.some((v) => v.skipped) || pkg.vtxos.length !== coins.length)
      throw new Error('Emergency exit did not include every current output')
    file.exitPackage = deserializeExitPackage(serializeExitPackage(pkg))
    file.feeFundingAddress = onchainWallet.address
    file.exitPackageSignature = hex.encode(schnorr.sign(exitPackageDigest(file), owner))
    return file
  } finally {
    await wallet.dispose()
    await Promise.allSettled([walletRepository[Symbol.asyncDispose](), contractRepository[Symbol.asyncDispose]()])
  }
}

function exitPackageDigest(file: LightRecoveryFile): Uint8Array {
  if (!file.exitPackage) throw new Error('This file has no prepared exit. Update your recovery file first.')
  const pkg = deserializeExitPackage(serializeExitPackage(file.exitPackage))
  return sha256(
    new TextEncoder().encode(
      `vaulted-light/exit-package/v1:${lightDescriptorDigest(file.descriptor)}:${file.feeFundingAddress}:${serializeExitPackage(pkg)}`,
    ),
  )
}

export function validateLightRecoveryFile(value: unknown): LightRecoveryFile {
  const valid = validateLightEnrollment(value)
  const supplied = value as LightRecoveryFile
  if (supplied.name !== 'vaulted-light-recovery' || supplied.version !== 1)
    throw new Error('Unsupported Light recovery file')
  if (!supplied.exitPackage) return { ...valid, name: supplied.name, version: 1, createdAt: supplied.createdAt || '' }
  const pkg = deserializeExitPackage(serializeExitPackage(supplied.exitPackage))
  const file: LightRecoveryFile = {
    ...valid,
    name: supplied.name,
    version: 1,
    createdAt: supplied.createdAt,
    exitPackage: pkg,
    exitPackageSignature: supplied.exitPackageSignature,
    feeFundingAddress: supplied.feeFundingAddress,
  }
  if (
    !isVaultBitcoinAddress(file.feeFundingAddress || '', valid.descriptor.network) ||
    !isVaultBitcoinAddress(pkg.sweepAddress, valid.descriptor.network) ||
    pkg.mode !== 'graph' ||
    pkg.network !== sdkNetworkName(valid.descriptor.network) ||
    !/^[0-9a-f]{128}$/.test(file.exitPackageSignature || '') ||
    !schnorr.verify(
      hex.decode(file.exitPackageSignature!),
      exitPackageDigest(file),
      hex.decode(valid.descriptor.ownerPub),
    )
  )
    throw new Error('Emergency exit is not signed by this wallet owner')
  return file
}

/** This path needs only a Bitcoin explorer and the saved owner-signed package. */
export async function executeLightRecovery(
  file: LightRecoveryFile,
  secret: string,
  signal: AbortSignal,
  onEvent: (event: ExecutorEvent) => void,
) {
  const valid = validateLightRecoveryFile(file)
  requireReleaseNetwork(valid.descriptor.network)
  if (!valid.exitPackage) throw new Error('Prepare a current emergency exit first')
  if (!/^[0-9a-f]{64}$/.test(secret.trim())) throw new Error('Enter your complete recovery secret')
  const material = hex.decode(secret.trim())
  let owner: Uint8Array | undefined
  try {
    owner = await unlockLightOwnerKey(valid.recoveryBackup, material, 'recovery-secret', valid.descriptor)
    const identity = SingleKey.fromPrivateKey(owner)
    const provider = new EsploraProvider('/esplora')
    const feeWallet = await OnchainWallet.create(identity, sdkNetworkName(valid.descriptor.network)!, provider)
    if (valid.feeFundingAddress !== feeWallet.address)
      throw new Error('Recovery fee address is not this owner’s Bitcoin address')
    const executor = new UnilateralExit.Executor(valid.exitPackage, provider, { feeWallet, signal })
    await requireConfirmedLightRecovery(valid.exitPackage, executor, onEvent)
    signal.throwIfAborted()
  } finally {
    material.fill(0)
    owner?.fill(0)
  }
}

/** An exhausted SDK iterator can still contain failed branches. Success requires every sweep. */
export async function requireConfirmedLightRecovery(
  pkg: ExitPackage,
  events: AsyncIterable<ExecutorEvent>,
  onEvent: (event: ExecutorEvent) => void,
) {
  const expected = new Map(
    pkg.steps.flatMap((step, index) => (step.kind === 'sweep' ? [[index, step.txid] as const] : [])),
  )
  if (!expected.size) throw new Error('Recovery file has no Bitcoin sweeps')
  const confirmed = new Set<number>()
  let failed = false
  for await (const event of events) {
    onEvent(event)
    if (event.status === 'failed') failed = true
    if (event.kind === 'sweep' && event.status === 'confirmed' && expected.get(event.stepIndex) === event.txid)
      confirmed.add(event.stepIndex)
  }
  if (failed || confirmed.size !== expected.size)
    throw new Error(
      'Recovery is incomplete. Keep the saved exit file and review the failed transactions before resuming.',
    )
}

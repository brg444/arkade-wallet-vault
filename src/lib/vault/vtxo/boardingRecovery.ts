import { p2tr } from '@scure/btc-signer'
import { hex } from '@scure/base'
import {
  EsploraProvider,
  SingleKey,
  createBoardingProgramScript,
  getNetwork,
  hasBoardingTxExpired,
  recoverBoardingProgram,
  type ExtendedCoin,
  type OnchainProvider,
} from '@arkade-os/sdk'
import { zeroBytes } from '../ceremony/directauth'
import type { EnrollmentSecrets } from '../tenantEnrollment'
import type { VaultStatus } from '../types'
import { unlockPhoneBip340 } from '../savingsSpend'
import { withVaultWalletState } from './walletWorker'
import { browserVaultLockManager, requireVaultLockManager, type VaultLockManager } from './lock'
import { MUTINYNET_OPERATOR_SIGNER_PUB, requireBoardingStatus, BOARDING_EXIT_DELAY, BOARDING_PROGRAM } from './board'

type RecoveryDependencies = {
  getBoardingUtxos?: (status: VaultStatus) => Promise<ExtendedCoin[]>
  unlockPhone?: (enrollment: EnrollmentSecrets, status: VaultStatus) => Promise<Uint8Array>
  recover?: typeof recoverBoardingProgram
  onchainProvider?: OnchainProvider
  locks?: VaultLockManager | null
}

const recoveryInFlight = new Set<string>()

function exactProgram(status: VaultStatus) {
  const descriptor = requireBoardingStatus(status, String(status.vtxoBoardingDescriptor?.boardingPub || ''))
  const program = {
    name: BOARDING_PROGRAM,
    boardingPubKey: hex.decode(descriptor.boardingPub).slice(1),
    cosignerPubKey: hex.decode(descriptor.vaultBoardCosignerPub).slice(1),
    recoveryPubKey: hex.decode(descriptor.recoveryPhonePub).slice(1),
  } as const
  const operatorPubKey = hex.decode(MUTINYNET_OPERATOR_SIGNER_PUB).slice(1)
  const boardingTimelock = { type: 'seconds' as const, value: BigInt(BOARDING_EXIT_DELAY) }
  const encoded = createBoardingProgramScript(program, operatorPubKey, boardingTimelock).encode()
  return { descriptor, program, operatorPubKey, boardingTimelock, encoded }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function currentBoardingUtxos(status: VaultStatus): Promise<ExtendedCoin[]> {
  return withVaultWalletState(status, ({ wallet }) => wallet.getBoardingUtxos())
}

export async function findMatureBoardingInputs(
  status: VaultStatus,
  dependencies: RecoveryDependencies = {},
): Promise<{ inputs: ExtendedCoin[]; totalSats: number }> {
  const { boardingTimelock, encoded } = exactProgram(status)
  const inputs = (await (dependencies.getBoardingUtxos || currentBoardingUtxos)(status)).filter(
    (coin) =>
      coin.status.confirmed &&
      equalBytes(Uint8Array.from(coin.tapTree), encoded) &&
      hasBoardingTxExpired(coin, boardingTimelock),
  )
  return {
    inputs,
    totalSats: inputs.reduce((sum, input) => sum + input.value, 0),
  }
}

export async function recoverMatureBoardingInputs(
  enrollment: EnrollmentSecrets,
  status: VaultStatus,
  dependencies: RecoveryDependencies = {},
): Promise<string> {
  const locks = requireVaultLockManager(
    dependencies.locks === undefined ? browserVaultLockManager() : dependencies.locks,
  )
  return locks.request(
    `arkade-vault-boarding-recovery:${status.vaultId}`,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock || recoveryInFlight.has(status.vaultId)) {
        throw new Error('boarding recovery is already in progress')
      }
      recoveryInFlight.add(status.vaultId)
      let phoneSecret: Uint8Array | undefined
      try {
        const { inputs } = await findMatureBoardingInputs(status, dependencies)
        if (inputs.length === 0) throw new Error('No matured received Bitcoin is ready to recover')
        const { descriptor, program, operatorPubKey, boardingTimelock } = exactProgram(status)
        phoneSecret = await (dependencies.unlockPhone || unlockPhoneBip340)(enrollment, status)
        const recoveryIdentity = SingleKey.fromPrivateKey(phoneSecret)
        const destination = p2tr(await recoveryIdentity.xOnlyPublicKey(), undefined, getNetwork('mutinynet')).address
        if (!destination) throw new Error('Could not derive the boarding recovery destination')
        if (destination !== p2tr(program.recoveryPubKey, undefined, getNetwork('mutinynet')).address) {
          throw new Error('Recovered phone key does not match the vault-board-v1 descriptor')
        }
        const txid = await (dependencies.recover || recoverBoardingProgram)({
          program,
          operatorPubKey,
          boardingTimelock,
          inputs,
          recoveryIdentity,
          destination,
          network: getNetwork(descriptor.network),
          onchainProvider: dependencies.onchainProvider || new EsploraProvider('/esplora'),
          maxFeeRateSatVb: status.feerateCapSatVb,
          absoluteFeeCapSats: BigInt(status.absoluteFeeCap),
        })
        if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('boarding recovery returned an invalid transaction id')
        return txid
      } finally {
        if (phoneSecret) zeroBytes(phoneSecret)
        recoveryInFlight.delete(status.vaultId)
      }
    },
  )
}

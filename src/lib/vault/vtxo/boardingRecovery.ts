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
import { networkPins, requireSdkNetworkName } from '../networkPins'
import { requireBoardingStatus, BOARDING_PROGRAM } from './board'

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
  const pins = networkPins(status.network)
  const operatorPubKey = hex.decode(pins.operatorSignerPub).slice(1)
  const boardingTimelock = { type: 'seconds' as const, value: BigInt(pins.boardExitDelay) }
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
        const chain = getNetwork(networkPins(status.network).sdkNetwork)
        const destination = p2tr(await recoveryIdentity.xOnlyPublicKey(), undefined, chain).address
        if (!destination) throw new Error('Could not derive the boarding recovery destination')
        if (destination !== p2tr(program.recoveryPubKey, undefined, chain).address) {
          throw new Error('Recovered phone key does not match the vault-board-v1 descriptor')
        }
        const txid = await (dependencies.recover || recoverBoardingProgram)({
          program,
          operatorPubKey,
          boardingTimelock,
          inputs,
          recoveryIdentity,
          destination,
          network: getNetwork(requireSdkNetworkName(descriptor.network)),
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

import {
  IndexedDBContractRepository,
  IndexedDBIntentRepository,
  IndexedDBWalletRepository,
  MessageBus,
  RestArkProvider,
  SingleKey,
  Wallet,
  WalletMessageHandler,
} from '@arkade-os/sdk'
import { hexToBytes } from './lib/vault/hex'
import { fetchVaultStatusUnpinned } from './lib/vault/status'
import { registerVaultPolicyV1ContractHandler, vaultPolicyV1Contract } from './lib/vault/vtxo/contractHandler'
import {
  loadActiveVaultBoardV2KeyForNamespace,
  requireVaultBoardV2Status,
  VAULT_BOARD_V2_EXIT_DELAY,
  VAULT_BOARD_V2_PROGRAM,
} from './lib/vault/vtxo/boardV2'
import { createVaultBoardV2SigningAdapter } from './lib/vault/vtxo/boardV2Adapter'
import {
  vaultReadonlyIntentDatabaseForNamespace,
  vaultReadonlyUpdaterTagForNamespace,
  vaultReadonlyWalletDatabaseForNamespace,
} from './lib/vault/vtxo/readonlyWorkerNames'
import { vaultArkServer, vaultPolicyV1ScriptFromStatus } from './lib/vault/vtxo/spend'

declare const self: ServiceWorkerGlobalScope

const namespace = new URL(self.location.href).searchParams.get('vault') || ''

registerVaultPolicyV1ContractHandler()

const walletRepository = new IndexedDBWalletRepository(vaultReadonlyWalletDatabaseForNamespace(namespace))
const contractRepository = new IndexedDBContractRepository(vaultReadonlyWalletDatabaseForNamespace(namespace))
const intentRepository = new IndexedDBIntentRepository(vaultReadonlyIntentDatabaseForNamespace(namespace))

const bus = new MessageBus(walletRepository, contractRepository, {
  messageHandlers: [new WalletMessageHandler({ messageTag: vaultReadonlyUpdaterTagForNamespace(namespace) })],
  tickIntervalMs: 5_000,
  messageTimeoutMs: 60_000,
  buildServices: async (config) => {
    const active = await loadActiveVaultBoardV2KeyForNamespace(namespace)
    const transient = active.secret.slice()
    active.secret.fill(0)
    let identityOwnsSecret = false
    try {
      const status = await fetchVaultStatusUnpinned(undefined, active.vaultId)
      const descriptor = requireVaultBoardV2Status(status, active.boardingPub)
      if (active.descriptorHash !== status.vtxoBoardingDescriptorHash) {
        throw new Error('active vault-board-v2 key is bound to a different descriptor')
      }
      const expectedArkServer = vaultArkServer()
      if (config.arkServer.url !== expectedArkServer) {
        throw new Error('worker Arkade Operator origin does not match this release')
      }
      const configuredOperator = String(config.arkServer.publicKey || '').toLowerCase()
      if (
        configuredOperator &&
        configuredOperator !== descriptor.operatorPub &&
        configuredOperator !== descriptor.operatorPub.slice(2)
      ) {
        throw new Error('worker Arkade Operator key does not match this release')
      }
      const identity = SingleKey.fromPrivateKey(transient)
      const signingAdapter = createVaultBoardV2SigningAdapter(status.vaultId, descriptor)
      const wallet = await Wallet.create({
        identity,
        arkServerUrl: config.arkServer.url,
        arkServerPublicKey: config.arkServer.publicKey,
        indexerUrl: config.indexerUrl,
        esploraUrl: config.esploraUrl,
        storage: { walletRepository, contractRepository, intentRepository },
        walletMode: 'static',
        boardingProgram: {
          name: VAULT_BOARD_V2_PROGRAM,
          boardingPubKey: await identity.xOnlyPublicKey(),
          cosignerPubKey: signingAdapter.publicKey,
          recoveryPubKey: hexToBytes(descriptor.recoveryPhonePub).slice(1),
        },
        boardingSigningAdapter: signingAdapter,
        boardingTimelock: { type: 'seconds', value: BigInt(VAULT_BOARD_V2_EXIT_DELAY) },
        settlementConfig: {
          boardingUtxoSweep: false,
          deprecatedSignerMigration: false,
          autoRenewVtxos: false,
          maxBoardingInputsPerSettle: 1,
          boardingSettleAddress: String(status.spendingArkAddress || ''),
        },
      })
      if ((await wallet.getBoardingAddress()) !== descriptor.address) {
        throw new Error('SDK worker derived a different vault-board-v2 address')
      }
      const manager = await wallet.getContractManager()
      for (const contract of (await manager.getContracts()).filter((candidate) => candidate.type === 'default')) {
        if (contract.state !== 'inactive') await manager.setContractState(contract.script, 'inactive')
        if ((contract.watch || 'watched') !== 'retained') {
          await manager.setContractWatchState(contract.script, 'retained')
        }
      }
      const spending = await manager.createContract(
        vaultPolicyV1Contract(vaultPolicyV1ScriptFromStatus(status), String(status.spendingArkAddress || '')),
      )
      if (spending.script !== String(status.spendingArkScript || '').toLowerCase()) {
        throw new Error('SDK worker registered a different Spending contract')
      }
      if (spending.state !== 'active') await manager.setContractState(spending.script, 'active')
      if ((spending.watch || 'watched') !== 'watched') {
        await manager.setContractWatchState(spending.script, 'watched')
      }
      identityOwnsSecret = true
      return { arkProvider: new RestArkProvider(config.arkServer.url), wallet, readonlyWallet: wallet }
    } finally {
      if (!identityOwnsSecret) transient.fill(0)
    }
  },
})

bus.start().catch((error) => console.error('Vault v2 wallet worker failed to start', error))

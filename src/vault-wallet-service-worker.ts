import {
  IndexedDBContractRepository,
  IndexedDBIntentRepository,
  IndexedDBWalletRepository,
  MessageBus,
  WalletMessageHandler,
} from '@arkade-os/sdk'
import { registerVaultPolicyV1ContractHandler } from './lib/vault/vtxo/contractHandler'
import {
  vaultReadonlyIntentDatabaseForNamespace,
  vaultReadonlyUpdaterTagForNamespace,
  vaultReadonlyWalletDatabaseForNamespace,
} from './lib/vault/vtxo/readonlyWorkerNames'

declare const self: ServiceWorkerGlobalScope

const namespace = new URL(self.location.href).searchParams.get('vault') || ''

registerVaultPolicyV1ContractHandler()

const walletRepository = new IndexedDBWalletRepository(vaultReadonlyWalletDatabaseForNamespace(namespace))
const contractRepository = new IndexedDBContractRepository(vaultReadonlyWalletDatabaseForNamespace(namespace))
const intentRepository = new IndexedDBIntentRepository(vaultReadonlyIntentDatabaseForNamespace(namespace))

const bus = new MessageBus(walletRepository, contractRepository, {
  messageHandlers: [new WalletMessageHandler({ messageTag: vaultReadonlyUpdaterTagForNamespace(namespace) })],
  intentRepository,
  tickIntervalMs: 5_000,
  messageTimeoutMs: 60_000,
})

bus.start().catch((error) => console.error('Vault readonly worker failed to start', error))

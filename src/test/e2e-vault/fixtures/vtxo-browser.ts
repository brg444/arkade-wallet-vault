import type { VaultStatus } from '../../../lib/vault/types'
import { ensureVaultWalletWorker, registerVaultWalletServiceWorker } from '../../../lib/vault/vtxo/walletWorker'
import {
  vaultWalletDatabase,
  vaultWalletUpdaterTag,
  vaultWalletWorkerScope,
} from '../../../lib/vault/vtxo/walletWorkerNames'

export async function registerWalletWorker(vaultId: string) {
  const { registration, worker } = await registerVaultWalletServiceWorker(vaultId)
  const registrations = await navigator.serviceWorker.getRegistrations()
  return {
    activeScriptUrl: registration.active?.scriptURL || worker.scriptURL,
    registrationCount: registrations.filter((candidate) => candidate.scope.includes('/__vault-wallet/')).length,
    scope: registration.scope,
    state: worker.state,
  }
}

export async function walletWorkerState(vaultId: string) {
  const registration = await navigator.serviceWorker.getRegistration(vaultWalletWorkerScope(vaultId))
  return {
    scope: registration?.scope || '',
    state: registration?.active?.state || '',
  }
}

export async function walletRuntimeSnapshot(status: VaultStatus, repositoryMarker?: string) {
  const runtime = await ensureVaultWalletWorker(status)
  const prior = await runtime.walletRepository.getWalletState()
  if (repositoryMarker !== undefined) {
    await runtime.walletRepository.saveWalletState({
      ...prior,
      settings: { ...prior?.settings, e2eWorkerRestartMarker: repositoryMarker },
    })
  }
  const repository = await runtime.walletRepository.getWalletState()
  return {
    address: await runtime.wallet.getBoardingAddress(),
    database: vaultWalletDatabase(status.vaultId),
    marker: repository?.settings?.e2eWorkerRestartMarker,
    scope: runtime.registration.scope,
    state: runtime.registration.active?.state,
  }
}

export function dispatchWalletUtxoUpdate(vaultId: string) {
  navigator.serviceWorker.dispatchEvent(
    new MessageEvent('message', {
      data: { tag: vaultWalletUpdaterTag(vaultId), type: 'UTXO_UPDATE' },
    }),
  )
}

export function dispatchWalletVtxoUpdate(vaultId: string) {
  navigator.serviceWorker.dispatchEvent(
    new MessageEvent('message', {
      data: { tag: vaultWalletUpdaterTag(vaultId), type: 'VTXO_UPDATE' },
    }),
  )
}

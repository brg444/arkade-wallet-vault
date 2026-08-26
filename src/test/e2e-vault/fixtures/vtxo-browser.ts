import { registerVaultWalletServiceWorker } from '../../../lib/vault/vtxo/walletWorker'
import { vaultWalletUpdaterTag, vaultWalletWorkerScope } from '../../../lib/vault/vtxo/walletWorkerNames'

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

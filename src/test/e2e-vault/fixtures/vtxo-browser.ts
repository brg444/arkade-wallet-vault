import { IndexedDBIntentRepository, type ArkIntentState } from '@arkade-os/sdk'
import type { VaultStatus } from '../../../lib/vault/types'
import {
  fetchVaultBoardingFunds,
  planVaultBoarding,
  VAULT_BOARD_V1,
  VAULT_BOARD_V1_EXIT_DELAY,
  VAULT_BOARD_V1_EXIT_DELAY_UNIT,
} from '../../../lib/vault/vtxo/board'
import { registerVaultReadonlyServiceWorker } from '../../../lib/vault/vtxo/readonlyWorker'
import {
  vaultReadonlyIntentDatabase,
  vaultReadonlyUpdaterTag,
  vaultReadonlyWorkerScope,
} from '../../../lib/vault/vtxo/readonlyWorkerNames'

const OUTPOINT_TXID = '11'.repeat(32)

export const BOARDING_OUTPOINT = `${OUTPOINT_TXID}:0`

export async function registerReadonlyWorker(vaultId: string) {
  const { registration, worker } = await registerVaultReadonlyServiceWorker(vaultId)
  const registrations = await navigator.serviceWorker.getRegistrations()
  return {
    activeScriptUrl: registration.active?.scriptURL || worker.scriptURL,
    registrationCount: registrations.filter((candidate) => candidate.scope.includes('/__vault-wallet/')).length,
    scope: registration.scope,
    state: worker.state,
  }
}

export async function readonlyWorkerState(vaultId: string) {
  const registration = await navigator.serviceWorker.getRegistration(vaultReadonlyWorkerScope(vaultId))
  return {
    scope: registration?.scope || '',
    state: registration?.active?.state || '',
  }
}

export function dispatchReadonlyUtxoUpdate(vaultId: string) {
  navigator.serviceWorker.dispatchEvent(
    new MessageEvent('message', {
      data: { tag: vaultReadonlyUpdaterTag(vaultId), type: 'UTXO_UPDATE' },
    }),
  )
}

export function dispatchReadonlyVtxoUpdate(vaultId: string) {
  navigator.serviceWorker.dispatchEvent(
    new MessageEvent('message', {
      data: { tag: vaultReadonlyUpdaterTag(vaultId), type: 'VTXO_UPDATE' },
    }),
  )
}

export interface IntentFixture {
  vaultId: string
  state: ArkIntentState
  commitmentTransactionId?: string
}

export async function seedBoardingIntent({ vaultId, state, commitmentTransactionId }: IntentFixture) {
  const repository = new IndexedDBIntentRepository(vaultReadonlyIntentDatabase(vaultId))
  const now = Date.now()
  try {
    await repository.saveIntent({
      intentTxId: `${state}:${vaultId}`,
      state,
      createdAt: now,
      updatedAt: now,
      registerProof: 'register-proof',
      registerProofMessage: '{}',
      deleteProof: 'delete-proof',
      deleteProofMessage: '{}',
      partialForfeits: [],
      intentVtxos: [{ txid: OUTPOINT_TXID, vout: 0 }],
      ...(commitmentTransactionId ? { commitmentTransactionId } : {}),
    })
  } finally {
    await repository[Symbol.asyncDispose]()
  }
}

export async function boardingIntentState(vaultId: string, destinationCommitments: string[] = []) {
  const plan = await planVaultBoarding(vaultId, [BOARDING_OUTPOINT], new Set(destinationCommitments))
  if (plan.settledOutpoints.length) return 'settled'
  if (plan.blockedOutpoints.length) return 'blocked'
  return 'eligible'
}

function boardingStatus(vaultId: string, boardingAddress: string): VaultStatus {
  return {
    enrolled: true,
    network: 'mutinynet',
    vaultId,
    vtxoBoardingActive: true,
    vtxoBoardingProgram: VAULT_BOARD_V1,
    vtxoBoardingAddress: boardingAddress,
    vtxoBoardingScript: `5120${'22'.repeat(32)}`,
    vtxoBoardingExitDelay: Number(VAULT_BOARD_V1_EXIT_DELAY),
    vtxoBoardingExitDelayUnit: VAULT_BOARD_V1_EXIT_DELAY_UNIT,
    spendingArkAddress: 'tark1fixture',
  } as VaultStatus
}

export async function boardingSnapshot(vaultId: string, boardingAddress: string) {
  return fetchVaultBoardingFunds(boardingStatus(vaultId, boardingAddress))
}

export function issuedVtxoSnapshot(amount: number, commitmentTransactionId: string) {
  return {
    balance: amount,
    history: [
      {
        txid: commitmentTransactionId,
        type: 'received' as const,
        amount,
        confirmed: true,
        blockTime: Math.floor(Date.now() / 1_000),
        account: 'spend' as const,
      },
    ],
  }
}

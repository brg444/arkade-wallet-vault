import { hex } from '@scure/base'
import { Transaction } from '@scure/btc-signer'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildVaultProgramDescriptor, familyFromDescriptor } from './program/descriptor'
import { PROGRAM_FIXTURE, scalarSecret } from './program/fixtures'
import {
  clearPendingSavingsHandoff,
  createPendingSavingsHandoff,
  loadPendingSavingsHandoff,
  savePendingSavingsHandoff,
  SAVINGS_HANDOFF_TTL_MS,
} from './savingsHandoff'
import { signSavingsPsbt } from './savingsSpend'

function phoneSignedPsbt() {
  const descriptor = buildVaultProgramDescriptor(PROGRAM_FIXTURE)
  const savings = familyFromDescriptor(descriptor).savings
  const leaf = savings.tapLeafScript?.find((entry) => hex.encode(entry[1].slice(0, -1)) === hex.encode(savings.admin))
  if (!leaf) throw new Error('Savings admin leaf missing')
  const tx = new Transaction({ version: 2, allowUnknownInputs: true, allowUnknownOutputs: true })
  tx.addInput({
    txid: new Uint8Array(32),
    index: 0,
    witnessUtxo: { script: savings.script, amount: 100_000n },
    tapInternalKey: savings.tapInternalKey,
    tapLeafScript: [leaf],
    sequence: 0xffffffff,
  })
  tx.addOutput({ script: savings.script, amount: 98_500n })
  return {
    descriptor,
    psbtHex: signSavingsPsbt(hex.encode(tx.toPSBT()), scalarSecret(3)),
  }
}

describe('pending Savings hardware handoff', () => {
  beforeEach(() => localStorage.clear())

  it('persists and restores the exact phone-signed PSBT', () => {
    const { descriptor, psbtHex } = phoneSignedPsbt()
    const now = Date.now()
    const pending = createPendingSavingsHandoff(
      {
        vaultId: descriptor.vaultId,
        psbtHex,
        destAddress: descriptor.savings.address,
        amountSats: 98_500,
        feeSats: 1_500,
        network: descriptor.network,
      },
      now,
    )
    savePendingSavingsHandoff(localStorage, pending)

    expect(loadPendingSavingsHandoff(localStorage, descriptor.vaultId, now + 1_000)).toEqual(pending)
  })

  it('deletes completed, expired, or locally corrupted handoffs', () => {
    const { descriptor, psbtHex } = phoneSignedPsbt()
    const now = Date.now()
    const pending = createPendingSavingsHandoff(
      {
        vaultId: descriptor.vaultId,
        psbtHex,
        destAddress: descriptor.savings.address,
        amountSats: 98_500,
        feeSats: 1_500,
        network: descriptor.network,
      },
      now,
    )
    savePendingSavingsHandoff(localStorage, pending)
    expect(loadPendingSavingsHandoff(localStorage, descriptor.vaultId, now + SAVINGS_HANDOFF_TTL_MS)).toBeNull()

    savePendingSavingsHandoff(localStorage, pending)
    clearPendingSavingsHandoff(localStorage, descriptor.vaultId)
    expect(loadPendingSavingsHandoff(localStorage, descriptor.vaultId, now + 1_000)).toBeNull()

    localStorage.setItem(
      `arkade-vault-savings-handoff-v1:${descriptor.vaultId}`,
      JSON.stringify({ ...pending, amountSats: 1 }),
    )
    expect(loadPendingSavingsHandoff(localStorage, descriptor.vaultId, now + 1_000)).toBeNull()
  })
})

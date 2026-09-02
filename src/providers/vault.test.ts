import { describe, expect, it } from 'vitest'
import { reviewedVtxoQuoteMatchesDraft, vaultDraftFee } from './vault'

describe('vault send draft fees', () => {
  it('keeps the Savings fallback out of an Arkade Spending draft', () => {
    expect(vaultDraftFee('spend', true)).toBe(0)
    expect(vaultDraftFee('savings', true)).toBe(1_500)
  })

  it('keeps approval bound to the amount, destination, and authoritative fee shown on Review', () => {
    const quote = {
      operationId: '11'.repeat(16),
      bundleDigest: '22'.repeat(32),
      destAddress: 'tark1reviewed',
      amountSats: 12_000,
      feeSats: 500,
      feePolicyDigest: '33'.repeat(32),
      reservationExpires: '2099-08-20T00:02:00Z',
      changeSats: 7_500,
      changeVout: 1,
    }
    expect(reviewedVtxoQuoteMatchesDraft(quote, { address: 'tark1reviewed', amount: 12_000, fee: 500 })).toBe(true)
    expect(reviewedVtxoQuoteMatchesDraft(quote, { address: 'tark1changed', amount: 12_000, fee: 500 })).toBe(false)
    expect(reviewedVtxoQuoteMatchesDraft(quote, { address: 'tark1reviewed', amount: 12_001, fee: 500 })).toBe(false)
    expect(reviewedVtxoQuoteMatchesDraft(quote, { address: 'tark1reviewed', amount: 12_000, fee: 501 })).toBe(false)
  })
})

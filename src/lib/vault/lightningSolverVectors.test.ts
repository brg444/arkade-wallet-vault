import { VHTLC } from '@arkade-os/sdk'
import { lightningSendVtxoScript, unilateralClaimDelay } from '@arkade-os/swap'
import { schnorr } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { buildLightningSendCandidates, matchLightningSendCandidate } from './lightningCovenant'

/**
 * Vectors produced with the current intent-solver construction
 * (`CovenantSwapScript` → `VHTLC.ScriptV2` with `withoutReceiver: true`).
 *
 * Key schedule matches `intent-solver/test/arkade/covenant.test.ts`:
 * `schnorr.getPublicKey(new Uint8Array(32).fill(n))`.
 */
const key = (fill: number): Uint8Array => schnorr.getPublicKey(new Uint8Array(32).fill(fill))
const p2tr = (program: Uint8Array): Uint8Array => Uint8Array.from([0x51, 0x20, ...program])

const SOLVER = key(1)
const SERVER = key(3)
const EMULATOR = key(9)
const CLIENT = key(11)
const REFUND_PKSCRIPT = p2tr(key(5))
const RECEIVER_PKSCRIPT = p2tr(key(13))
const PREIMAGE_HASH_HEX = 'da9fa986cf48f56ad387495f8e840ea9ed10889bf82f67c8a7b10d5d8a27886c'
const REFUND_LOCKTIME = 1_800_000_000
const SERVER_EXIT_DELAY = 605_184

function solverNineLeaf(claimDelay: number): InstanceType<typeof VHTLC.ScriptV2> {
  const eight = lightningSendVtxoScript({
    solverPubkey: SOLVER,
    refundLocktime: REFUND_LOCKTIME,
    serverPubkey: SERVER,
    paymentHash: PREIMAGE_HASH_HEX,
    claimDelay,
    emulatorPubkey: EMULATOR,
    refundPkScript: REFUND_PKSCRIPT,
    senderPubkey: CLIENT,
    receiverPkScript: RECEIVER_PKSCRIPT,
  })
  return new VHTLC.ScriptV2({
    ...eight.options,
    nonInteractiveRefund: { ...eight.options.nonInteractiveRefund!, withoutReceiver: true },
  })
}

describe('Lightning lockup vectors from the current solver construction', () => {
  it('selects the nine-leaf tree the intent-solver quotes by default', () => {
    const claimDelay = unilateralClaimDelay(SERVER_EXIT_DELAY)
    const treeParams = {
      solverPubkey: SOLVER,
      refundLocktime: REFUND_LOCKTIME,
      serverPubkey: SERVER,
      paymentHash: PREIMAGE_HASH_HEX,
      claimDelay,
      emulatorPubkey: EMULATOR,
      refundPkScript: REFUND_PKSCRIPT,
      senderPubkey: CLIENT,
      receiverPkScript: RECEIVER_PKSCRIPT,
    }
    const candidates = buildLightningSendCandidates(treeParams, 'ark', SERVER)
    const quoted = solverNineLeaf(claimDelay).address('ark', SERVER).encode()
    expect(quoted).toBe(candidates.nineAddress)
    expect(quoted).not.toBe(candidates.eightAddress)
    const matched = matchLightningSendCandidate(candidates, quoted)
    expect(matched.variant).toBe('nine-leaf')
    expect(matched.address).toBe(quoted)
    expect(hex.encode(matched.script.pkScript)).toBe(hex.encode(solverNineLeaf(claimDelay).pkScript))
  })

  it('still matches an eight-leaf quote from an older swap 0.0.10 lightningSendVtxoScript solver', () => {
    const claimDelay = unilateralClaimDelay(SERVER_EXIT_DELAY)
    const treeParams = {
      solverPubkey: SOLVER,
      refundLocktime: REFUND_LOCKTIME,
      serverPubkey: SERVER,
      paymentHash: PREIMAGE_HASH_HEX,
      claimDelay,
      emulatorPubkey: EMULATOR,
      refundPkScript: REFUND_PKSCRIPT,
      senderPubkey: CLIENT,
      receiverPkScript: RECEIVER_PKSCRIPT,
    }
    const candidates = buildLightningSendCandidates(treeParams, 'ark', SERVER)
    const quoted = lightningSendVtxoScript(treeParams).address('ark', SERVER).encode()
    expect(matchLightningSendCandidate(candidates, quoted).variant).toBe('eight-leaf')
  })
})

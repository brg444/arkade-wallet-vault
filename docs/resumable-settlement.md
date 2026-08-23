# Interrupted VTXO settlement

Mainnet v1 uses the standard SDK `Wallet.settle` path and treats a lost browser
process as an interrupted attempt. It does not reconstruct a selected or
in-progress MuSig2 session. The wallet keeps every input locked until the
Operator proves that the old intent is live and deletable or the indexer proves
that the batch consumed it.

This posture reuses the SDK transaction builder, validation, signing, batch
handler, and repositories. It adds durable intent transitions and a strict
Operator abort-or-complete boundary.

## Wallet record

Before registration reaches the network, the SDK persists:

- the intent proof transaction ID, exact proof, and canonical message;
- the exact delete proof and message;
- the input outpoints and signer descriptor;
- the registration state and later Operator intent ID; and
- a repository-owned revision for atomic state transitions.

These economic-identity fields remain fixed after creation. Repository errors
make VTXO and boarding input selection unavailable. A second tab, worker, or
reconciliation task cannot overwrite a newer or terminal transition with a
stale record.

The registration proof already commits the input values, tap trees, outputs,
output indexes, and cosigner keys. Mainnet v1 does not add another generic
settlement snapshot or persist a second copy of that transaction context.

## Recovery procedure

Recovery acquires the vault's exclusive Web Lock and reads the exact Operator
status for the retained intent. It follows one conservative transition:

| Operator state | Wallet action |
| --- | --- |
| Registration response ambiguous | Retry only the byte-identical retained registration request to recover its identifier. Keep the inputs locked. |
| `LIVE` | Submit an identifier-bound delete using the retained proof. Start a fresh `Wallet.settle` only after the Operator confirms deletion. |
| `SELECTED` or `IN_PROGRESS` | Keep the inputs locked and wait. A new signing session or different batch acknowledgement is ineligible. |
| `TERMINAL_OR_UNKNOWN` | Reconcile the exact inputs and expected vault output with the indexer. Consumed inputs can prove completion; absence or an unspent result does not release them. |

Automatic boarding can start a fresh attempt after deletion because its
destination is always the vault's `vault-policy-v1` address and its amount is
derived from the retained boarding output. An interrupted arbitrary payment is
not recreated silently; the user starts a new payment after the old intent is
resolved.

The SDK intent repository is the only registration authority. The wallet's
temporary accepted-ID cache, duplicate recovery, and memory mirror are removed
when the new SDK is pinned. A transport adapter may retain HTTP and event-stream
diagnostics without writing lifecycle state.

## Operator boundary

The Operator has two durable phases.

Before `PREPARED`, a confirmation, construction, nonce, signature, or signing
timeout aborts the attempt. The Operator atomically restores the exact selected
intents to `LIVE`, retains their VTXO and boarding locks, and removes pending
unlock entries. A restore failure halts batch scheduling and readiness while
the original round evidence remains intact.

`PREPARED` begins only after the exact signed commitment transaction, signed
forfeit transactions, intent membership, and final projection fields are
durable. From that point the batch is irrevocable. A process restart or
ambiguous broadcast response re-broadcasts and reconciles the same transaction;
it never restores the intents or releases their locks. Finalization and cleanup
follow proof of the exact commitment outcome.

Startup branches on that state:

1. A provably pre-`PREPARED` round restores its selected intents before
   ephemeral session cleanup.
2. A `PREPARED` round resumes exact broadcast and reconciliation.
3. A finalized round performs ordinary cleanup.

The next round cannot start until the applicable transition commits.

## Qualification

Release tests inject failure:

- before and after the write-ahead registration record;
- before registration transmission, after Operator acceptance, and during the
  response body;
- during confirmation, tree construction, nonce collection, and signature
  collection;
- before durable `PREPARED`, between `PREPARED` and broadcast, after node
  acceptance with a lost response, and before final projection persistence;
- during restore, exact deletion, indexer reconciliation, and startup; and
- with two browser contexts and concurrent Operator abort/prepare attempts.

Every pre-`PREPARED` failure must produce one restored intent with both lock
classes intact. Every `PREPARED` failure must retain the exact batch and resume
it without reporting `LIVE`. No test may make an input selectable while either
outcome remains unresolved.

## Deferred seamless continuation

Continuing the same batch after a reload is a later availability feature. It
requires identity-protected persistence of the actual MuSig2 private nonce
state before nonce publication, plus an exact-intent event journal with a
gap-free replay-to-live handoff. A static session snapshot does not provide
that guarantee because regenerated nonces cannot sign the Operator's retained
aggregate nonces.

That work remains separate from the first mainnet boarding release. Lightning
also remains a separate durable saga after ordinary VTXO Spending and boarding
are qualified.

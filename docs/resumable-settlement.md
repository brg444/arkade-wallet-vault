# Resumable VTXO settlement

Mainnet boarding requires settlement to survive a browser reload after the
Operator may have accepted an intent. Persisting the registration proof and
Operator identifier is necessary but insufficient. The wallet must restore the
same signing session and transaction context before it can safely rejoin the
batch.

## Current safety boundary

The candidate SDK records the exact registration proof and canonical message
before submission. An ambiguous response leaves the inputs locked. Exact retry
can recover the retained Operator identifier while the original process and
signing session remain available.

Candidate arkd exposes exact-identifier lifecycle state. A selected or
in-progress response includes the active batch identifier and expiry. This
recovers the proposal identity, not the ephemeral signer session or every event
needed to finish its signing protocol.

A reload loses the random MuSig2 `TreeSignerSession`. A replacement session has
a different public key from the one committed by the registration message. The
current intent row also lacks the complete VTXO or boarding inputs, recipients,
assets, and validation context required by the batch handler and database
finalizer. Registration replay alone would create an intent the wallet cannot
complete.

## Required snapshot

Before registration can reach the network, one durable record must bind:

- the intent proof transaction ID, exact proof, and canonical message;
- the delete proof and message;
- a lossless serialization of every input needed by the signer router,
  ownership checks, and finalizer;
- the exact recipients, amounts, assets, and onchain output indexes;
- the expected settlement outputs and relevant program identities;
- the signing-session public key; and
- an opaque, protected signer-session envelope.

The intent identity, request bytes, and snapshot digest are immutable after the
write-ahead record is created. A second process may reuse only a byte-identical
record.

The signer-session envelope belongs to the signing identity, while the SDK
stores and returns only its opaque representation. A generic raw-session-secret
export is outside the interface. The identity creates and restores the envelope
under protection at least as strong as its routine signing key, and an identity
that cannot restore a session cannot advertise resumable settlement.

## Resume procedure

Resume acquires the vault's exclusive Web Lock and requires the normal device
unlock before handling protected state. It then:

1. Reads the complete snapshot and verifies its digest and immutable intent
   fields.
2. Restores the signer session through the identity and verifies that its public
   key matches the cosigner key in the stored registration message.
3. Reconstructs the inputs, recipients, and batch handler, then reproduces the
   exact registration request bytes.
4. Opens the event stream before any registration retry or acknowledgement.
5. Reads the exact Operator intent status.

The Operator status drives a conservative transition:

| Operator state | Wallet action |
| --- | --- |
| `LIVE` | Keep the inputs locked and retry only the exact retained registration request when the active flow requires its identifier. |
| `SELECTED` | Recreate the retained `BatchStarted` event from its batch ID and expiry, acknowledge the exact intent ID, and continue with the restored handler. |
| `IN_PROGRESS` | Keep the operation locked. Resume only when the Operator or SDK can supply every missed signing-stage event required by the handler. |
| `TERMINAL_OR_UNKNOWN` | Reconcile the exact inputs and expected outputs with the indexer. Never infer settlement or release from status absence. |

An exact proof-based deletion with an unambiguous response may release an
unaccepted intent. An indexer result may prove that inputs were consumed or
remain available under the defined recovery policy. Transport errors, missing
history, or inconsistent state retain the lock.

## Persistence and concurrency

Mainnet configuration requires a durable intent repository. An absent or
unreadable repository fails closed for VTXO and boarding selection. Raw
ownership and recovery views may still report the funds, but no automatic send
or settlement may select them.

The snapshot, write-ahead state, and later Operator identifier need atomic
compare-and-set transitions. A reload, worker, or second tab cannot replace an
ambiguous, selected, active, or terminal record with a newly constructed
request. Web Locks provide the live browser exclusion; durable state remains the
safety boundary after a process disappears.

## Qualification

Release tests must inject failure at each boundary:

- before and after the write-ahead snapshot;
- before request transmission, after Operator acceptance, and during response
  body delivery;
- before and after durable identifier persistence;
- before `BatchStarted`, after acknowledgement, and during every signing stage;
- during snapshot read, session restoration, and repository compare-and-set;
- across reloads, worker restarts, and two live tabs; and
- after active Operator status retention expires.

Every test must establish both outcomes: no locked input becomes spendable, and
a recoverable operation resumes with the same request, session key, inputs,
recipients, and expected outputs.

This contract applies to ordinary SDK settlement and boarding. Lightning uses a
separate durable saga after VTXO Spending and boarding are qualified.

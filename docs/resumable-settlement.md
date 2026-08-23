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

The current Operator cannot reconstruct the missing protocol prefix after tree
signing starts. The unsigned tree exists only in the finalization goroutine
before publication, and public nonces, topic mappings, and signing progress are
split across live stores that reset with the round. Persisted round events begin
again only after finalization data exists. A larger status response cannot fill
that gap safely.

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
- a minimal input delta for facts the proof PSBT does not contain, including
  VTXO or boarding kind, forfeit leaves, and normalized recovery state used by
  the finalizer;
- the exact recipients, amounts, assets, and onchain output indexes;
- the expected settlement outputs and relevant program identities;
- the canonical registration message that commits the signing-session public
  key; and
- an adjacent opaque, protected signer-session envelope.

The intent identity, request bytes, snapshot digest, and envelope ciphertext are
immutable after the write-ahead record is created. The envelope is outside the
snapshot digest and authenticated with the wallet or vault identity, intent
proof transaction ID, and snapshot digest. A second process may reuse only a
byte-identical record.

The signer-session envelope belongs to the signing identity, while the SDK
stores and returns only its opaque representation. A generic raw-session-secret
export is outside the interface. The identity creates and restores the envelope
under protection at least as strong as its routine signing key, and an identity
that cannot restore a session cannot advertise resumable settlement.

The first snapshot version covers ordinary VTXOs and boarding inputs. An
ArkNote or condition input can carry a preimage or other private witness in
`extraWitness`, and the registration proof PSBT would contain that witness. The
plaintext intent repository is limited to public transaction data. Such an
input remains ineligible for durable settlement until the identity can place
its witness material inside the protected envelope. Registration stops before
the proof is persisted or sent when protected storage is unavailable.

## Resume procedure

Resume acquires the vault's exclusive Web Lock and requires the normal device
unlock before handling protected state. It then:

1. Reads the complete snapshot and verifies its digest and immutable intent
   fields.
2. Restores the signer session through the identity and verifies that its public
   key matches the cosigner key in the stored registration message.
3. Reconstructs the inputs, recipients, and batch handler, then reproduces the
   exact registration request bytes.
4. Opens the exact-intent replay cursor before any registration retry or
   acknowledgement. The cursor atomically captures its high-water mark, replays
   the authorized prefix, and then tails later events on the same stream.
5. Reads the exact Operator intent status within the same batch generation.

The Operator status drives a conservative transition:

| Operator state | Wallet action |
| --- | --- |
| `LIVE` | Keep the inputs locked and retry only the exact retained registration request when the active flow requires its identifier. |
| `SELECTED` | Recreate the retained `BatchStarted` event from its batch ID and expiry, acknowledge the exact intent ID, and continue with the restored handler. |
| `IN_PROGRESS` | Keep the operation locked. Resume only when the Operator or SDK can supply every missed signing-stage event required by the handler. |
| `TERMINAL_OR_UNKNOWN` | Reconcile the exact inputs and expected outputs with the indexer. Never infer settlement or release from status absence. |

## Operator replay journal

Each batch generation needs an append-only journal containing exact intent
membership and ordered event records. The Operator persists an event and its
authorized topics before publishing it. Every record binds the batch ID,
generation, monotonic sequence, event payload, and topic capability. A replay
request authenticates one exact intent and returns only its authorized shared
or intent-specific records.

The cursor establishes membership and a high-water mark in one snapshot,
returns the ordered prefix after the requested sequence, and hands the same
connection to live publication without a gap or duplicate. Restoring an intent
to the live queue atomically invalidates its selected generation. Terminal and
reconciliation records survive later rounds; expired, missing, or corrupt
retention returns replay unavailable, never a synthetic terminal outcome.

For an Operator restart before transaction broadcast, the initial mainnet
posture is durable batch failure and atomic intent restoration. Once broadcast
may have occurred, absence is not proof of failure: the record remains unknown
until chain and indexer reconciliation establishes an outcome. Persisting the
Operator's own private MuSig2 coordinator state for restart continuation is a
separate design and review boundary.

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

The SDK owns those transitions. A wallet transport adapter may preserve HTTP
or event-stream diagnostics, but it does not keep another accepted-identifier
cache or write the intent row. Removing the preview wallet cache is part of the
SDK pin, so registration has one durable authority.

## Qualification

Release tests must inject failure at each boundary:

- before and after the write-ahead snapshot;
- before request transmission, after Operator acceptance, and during response
  body delivery;
- before and after durable identifier persistence;
- before `BatchStarted`, after acknowledgement, and during every signing stage;
- between journal persistence and publication, during replay high-water capture,
  and while a new event arrives at the replay-to-live handoff;
- during snapshot read, session restoration, and repository compare-and-set;
- across reloads, worker restarts, and two live tabs; and
- after active Operator status retention expires.

Every test must establish both outcomes: no locked input becomes spendable, and
a recoverable operation resumes with the same request, session key, inputs,
recipients, and expected outputs.

Journal tests must also reject stale batch generations, mixed batch IDs,
unauthorized intent topics, missing ordered prefixes, and a globally delivered
failure that does not match the operation's established batch ID.

This contract applies to ordinary SDK settlement and boarding. Lightning uses a
separate durable saga after VTXO Spending and boarding are qualified.

# VTXO boarding

`vault-board-v1` is the only L1 entry into Spending. Spending itself contains
VTXOs, not ordinary onchain outputs.

```text
Savings spend or onchain receive
  -> confirmed vault-board-v1 output
    -> SDK settle to vault-policy-v1
```

The Spending receive view publishes one BIP21 request containing the Arkade
address and this Bitcoin intermediate. An Arkade-aware sender creates a VTXO
directly. An onchain sender funds the intermediate. The wallet detects confirmed
intermediate outputs and settles them to `vault-policy-v1` while it is open.

Moving Savings to Spending uses the same path. The Savings PSBT pays the exact
`vault-board-v1` address, then the ordinary boarding coordinator completes the
move after confirmation. External Savings withdrawals may still use another
Bitcoin address.

The intermediate uses the SDK's standard boarding tree: device + Arkade
Operator before expiry, and device-only recovery after 604672 seconds. The
vault service publishes the exact address, script, program name, and delay. The
client reconstructs the tree from the device and Operator keys and refuses any
mismatch before funding or signing it.

The settlement output is explicitly the `vault-policy-v1` Arkade address; SDK
default change is not accepted.
The server recognizes only the exact advertised `vault-board-v1` script as an
internal transfer: its L1 fee counts toward the rolling allowance, while its
principal is debited once, when a later VTXO payment leaves Spending.

## SDK observations

- `Wallet.create()` always constructs `DefaultVtxo` as its receive contract.
  It does not accept a custom offchain tapscript. Boarding passes an explicit
  `vault-policy-v1` output to `wallet.settle()` because parameterless settle
  creates a default VTXO.
- The SDK's background boarding poll requires a continuously available signing
  `Identity`. The vault's device key is PRF-wrapped and only exists in memory
  after a user verification ceremony. The wallet detects unfinished boarding
  after suspension or reload and requests device approval before settling it.
- `settlementConfig: false` is required for this coordinator. Otherwise the
  SDK manager may race the explicit policy-directed settle with its own
  parameterless default-output settle.
- The SDK defaults its wallet and contract repositories to one global IndexedDB
  database. Contract initialization loads every contract in that database, and
  wallet sync metadata is global to it. The Vault client supplies one versioned
  database per vault for both repositories and a separate per-vault intent
  database. The old global database is retired preview state and is not
  migrated.
- The explicit coordinator uses one Web Lock per vault. A supporting browser
  prevents a second tab from registering a competing intent or requesting
  another device approval. Boarding and ordinary sends fail closed when Web
  Locks are unavailable. Mainnet qualification must define the supported
  browser boundary and cover deterministic two-context races.
- A boarding settlement can outlive an ordinary HTTP request because it waits
  on the Operator event stream. The Arkade same-origin route must remain a
  direct streaming rewrite. A buffered serverless function breaks the event
  stream before settlement completes.
- SDK 0.4.65 uses native `EventSource` by default for `Wallet.settle()`. Its
  error handler discards the HTTP status, response body, and browser transport
  detail, then throws only `EventSource error`. The vault coordinator uses a
  fetch-streaming `RestArkProvider` subclass instead. It sends the required
  `Accept: text/event-stream` header explicitly and preserves non-200 Operator
  diagnostics without changing the SDK settlement state machine.
- arkd gives each registration a random UUID. The proof transaction ID is not
  the intent ID. Candidate arkd changes retain a proof-to-identifier mapping
  for live and selected intents, so an exact canonical registration retry
  returns the same UUID and a mutated request fails closed.
- Candidate SDK changes write the complete request before submission, mark the
  registration ambiguous before the network call, and durably commit and read
  back the returned UUID before reporting success. The wallet retries an
  ambiguous response once with the same signed request while the signing
  session is alive. Automatic replay after a crash or reload is not complete;
  the persisted row stays locked pending recovery. Safe reload recovery also
  needs a restorable signing session and the exact inputs and recipients needed
  to reconstruct the settlement handler.
- The durable snapshot may serialize ordinary VTXOs and boarding inputs in the
  clear because they contain public transaction data. ArkNote and condition
  inputs can carry a private witness in `extraWitness`; the SDK must refuse
  durable registration for those inputs until that witness can be sealed by the
  signing identity. The intent repository never becomes a preimage store.
- Candidate SDK input selection treats unreadable intent state as unavailable
  and excludes inputs held by nonterminal intents from ordinary settlement,
  balance selection, and boarding. A fully read, unstructured HTTP 429 is the
  only registration rejection that releases the prepared record; structured
  errors, malformed responses, transport failures, and duplicate conflicts
  remain ambiguous and locked.
- Candidate arkd changes also match `BoardingInputs` during proof-based deletion
  and restore a selected confirmation set atomically. An exact-identifier
  lifecycle endpoint reports live, selected, in-progress, or terminal-or-unknown
  state. Selected and in-progress responses carry the active batch identifier
  and expiry. Those changes still need an upstream release, deployment, and
  Redis-backed qualification.
- A selected intent can recover a missed `BatchStarted` event from the exact
  lifecycle response. In-progress settlement still needs durable replay of
  every later signing-stage event required by the handler. Terminal-or-unknown
  never proves completion or permits the wallet to release inputs.
- Current arkd stores cannot reconstruct that later replay. The unsigned VTXO
  tree chunks and ordered nonce events are not durable, while live signing and
  forfeit stores are reset with the round. Mainnet recovery therefore requires
  a persist-before-publish, exact-intent event journal and a cursor that replays
  an authorized prefix before handing the same connection to live events.

The protected reload contract and failure-injection requirements are defined in
[resumable settlement](resumable-settlement.md).

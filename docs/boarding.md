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
The Spending balance includes unconfirmed and confirmed value at that pinned
intermediate as soon as the Bitcoin transaction is indexed. Send selection
continues to use only settled VTXOs, so the visible deposit is not presented as
spendable before the Operator batch completes.

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
  after suspension or reload. Every new document starts locked; the ordinary
  passkey unlock restores the session signer and reconciliation then resumes.
- `settlementConfig: false` is required for this coordinator. Otherwise the
  SDK manager may race the explicit policy-directed settle with its own
  parameterless default-output settle.
- The SDK defaults its wallet and contract repositories to IndexedDB. The
  temporary boarding wallet instead uses fresh SDK in-memory repositories. It
  has no durable wallet state to migrate or reconcile and no intent repository:
  the live `Wallet.settle()` call owns the attempt, while the Operator remains
  authoritative for queued intent state.
- The explicit coordinator uses one Web Lock per vault. A supporting browser
  prevents a second tab from registering a competing intent or requesting
  another device approval. Boarding and ordinary sends fail closed when Web
  Locks are unavailable. Mainnet qualification must define the supported
  browser boundary and cover deterministic two-context races.
- A boarding settlement can outlive an ordinary HTTP request because it waits
  on the Operator event stream. The Arkade same-origin route must remain a
  direct streaming rewrite. A buffered serverless function breaks the event
  stream before settlement completes.
- Boarding uses the SDK's `RestArkProvider` and `Wallet.settle()` directly.
  The SDK and Operator own registration, deletion, event streaming, and batch
  confirmation. Vault code retains no copy of those protocol messages.
- `Wallet.settle()` starts SDK managers and indexer watchers. Each automatic
  attempt owns one temporary wallet and two in-memory SDK repositories, then
  disposes all three on success or failure.
- The automatic Vault coordinator accepts confirmed boarding inputs and the
  fixed `vault-policy-v1` output. It does not accept ArkNote or condition inputs
  whose registration proof can contain private `extraWitness` material.
- The coordinator does not replay registrations, infer Operator state, resume
  MuSig2 sessions, or implement a second protocol state machine. It passes the
  confirmed input to `Wallet.settle()` on each exclusive attempt. The SDK owns
  registration and duplicate recovery; the Operator owns queued intent state
  and release. No local intent row suppresses a retry of an onchain input that
  remains unspent.
- SDK intent persistence is deliberately not enabled for the temporary
  boarding wallet. Its generic startup reconciliation checks inputs through the
  VTXO indexer, while a boarding input is an onchain UTXO. A retry therefore
  remains an SDK settle against the authoritative onchain UTXO, with the current
  Operator's boarding-input deletion behavior. Crash and missed-event recovery
  remain live mainnet qualification cases.
- During live Mutinynet recovery, a queued intent entered an active batch before
  the SDK's duplicate-input path could delete it. The Operator correctly could
  not match the active intent, returned `INVALID_INTENT_PROOF` because no
  matching intents were found, and then requeued it when the unconfirmed batch
  failed. A fixed delay races the Operator's active and queued phases. The
  adapter instead watches the SDK provider stream for the next `batch_failed`
  event on the exact outpoints, then immediately retries the identical
  `Wallet.settle()` request once while the already approved device key remains
  live. The wait is bounded, closes its stream, and does not retry any other
  error or add an Operator endpoint.

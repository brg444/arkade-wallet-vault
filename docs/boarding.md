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
  database. The application never reads or migrates the SDK's global default
  database.
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
  Vault code does not override intent registration, deletion, event streaming,
  or duplicate handling. The SDK and `arkade.computer` own that protocol
  lifecycle.
- `Wallet.settle()` starts SDK managers and indexer watchers. Each automatic
  attempt owns a temporary wallet and three per-vault repositories, then
  disposes the wallet before closing those repositories on success or failure.
- The automatic Vault coordinator accepts confirmed boarding inputs and the
  fixed `vault-policy-v1` output. It does not accept ArkNote or condition inputs
  whose registration proof can contain private `extraWitness` material.
- The coordinator does not replay registrations, infer Operator state, resume
  MuSig2 sessions, or implement a second protocol state machine. It passes the
  confirmed input to `Wallet.settle()` on each exclusive attempt. The SDK owns
  persisted intent state and duplicate recovery; the Operator owns registration
  release. Pre-filtering inputs from the SDK intent repository is deliberately
  avoided because a retained local row must not permanently suppress the SDK's
  recovery path.
- SDK 0.4.65 persists intent snapshots, but its generic startup reconciliation
  checks inputs through the VTXO indexer. A boarding input is an onchain UTXO,
  so that reconciliation alone cannot prove it consumed. The Vault adapter does
  not reinterpret the row; retry remains an SDK settle against the authoritative
  onchain UTXO, with the current Operator's boarding-input deletion behavior.
  Crash and missed-event recovery remain live mainnet qualification cases.
- During live Mutinynet recovery, the SDK's duplicate-input path observed the
  old intent disappear between its duplicate response and signed delete. The
  delete returned `INVALID_INTENT_PROOF: no matching intents`, and the SDK did
  not perform the now-safe registration. The adapter retries the identical
  `Wallet.settle()` request once while the already approved device key remains
  live. It does not retry any other error or add an Operator endpoint.

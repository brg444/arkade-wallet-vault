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
- Before creating that wallet, the coordinator reads the SDK intent
  repository's public nonterminal outpoint set, excludes every reported
  outpoint from another boarding attempt, and stops settlement before any
  Operator call when that set cannot be read.
- The automatic Vault coordinator accepts confirmed boarding inputs and the
  fixed `vault-policy-v1` output. It does not accept ArkNote or condition inputs
  whose registration proof can contain private `extraWitness` material.
- The coordinator does not replay registrations, infer Operator state, resume
  MuSig2 sessions, or implement a second protocol state machine. Interrupted
  settlement follows the behavior of the pinned SDK and deployed Operator. A
  retained nonterminal intent pauses automatic boarding until its inputs are
  consumed or the intent is otherwise resolved. The deployed interface cannot
  always resolve that ambiguity after a browser crash, so this remains an
  availability gate for mainnet qualification.
- The SDK marks an attempt cancelled after settlement throws, even when its
  best-effort intent deletion was not acknowledged. The current deployed
  Operator does not resolve deletion by a boarding input, so the local terminal
  row can hide a retained remote intent and a later attempt can collide with
  it. The Operator rejects the duplicate input, but automatic recovery remains
  unavailable. Mainnet boarding requires a deployed cancellation behavior that
  is qualified for boarding inputs; Vault code does not substitute another
  intent lifecycle.

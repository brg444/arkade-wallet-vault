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
  another device approval. Browsers without Web Locks currently execute
  without equivalent exclusivity; a durable lease or an explicit capability
  gate is required before mainnet.
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
  the intent ID and cannot reattach a new listener. The SDK writes the returned
  UUID to its `intentRepository` only after `registerIntent` returns, and treats
  persistence failures as observational. A crash in that window leaves the
  Operator intent without a recoverable local ID. The provider must durably
  commit the ID before reporting success, or the SDK contract must make that
  persistence mandatory.
- Deletion cannot match a boarding-only intent until arkd
  `DeleteIntentsByProof` includes `BoardingInputs`. An intent popped into a
  confirmation round is also invisible until arkd restores it atomically.
- A clean event-stream reconnect does not replay a missed `BatchStarted` event.
  The Operator or SDK needs a read-reconcile path for that lifecycle stage.

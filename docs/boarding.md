# VTXO boarding

`vault-board-v1` is a distinct L1 intermediate. Existing Spending outputs are
not arkd boarding outputs and are never advertised as if they were.

```text
L1 Spending routine spend
  -> confirmed vault-board-v1 output
    -> SDK settle to vault-policy-v1
```

The Spending receive view publishes one BIP21 request containing the Arkade
address and this Bitcoin intermediate. The wallet detects confirmed deposits
and settles them to `vault-policy-v1` while it is open. Older confirmed Spending
outputs are reconciled through one routine transfer to the same intermediate.
That transfer still requires device approval because the existing output cannot
move without its device signature.

The intermediate uses the SDK's standard boarding tree: device + Arkade
Operator before expiry, and device-only recovery after 604672 seconds. The
vault service publishes the exact address, script, program name, and delay. The
client reconstructs the tree from the device and Operator keys and refuses any
mismatch before funding or signing it.

Savings is never a boarding source. The settlement output is explicitly the
`vault-policy-v1` Arkade address; SDK default change is not accepted.
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
- A boarding settlement can outlive an ordinary HTTP request because it waits
  on the Operator event stream. The Arkade same-origin route must remain a
  direct streaming rewrite. A buffered serverless function breaks the event
  stream before settlement completes.
- SDK 0.4.28 uses native `EventSource` for `Wallet.settle()`. Its error handler
  discards the HTTP status, response body, and browser transport detail, then
  throws only `EventSource error`. The vault coordinator uses a fetch-streaming
  `RestArkProvider` subclass instead. It sends the required
  `Accept: text/event-stream` header explicitly and preserves non-200 Operator
  diagnostics without changing the SDK settlement state machine.
- A settlement intent survives a page reload in the Operator queue. SDK 0.4.28
  treats the resulting duplicate input by deleting and recreating the intent.
  That races the Operator's short confirmation stage: deletion can report
  `no matching intents`, or the round can fail with `not enough intent
confirmations`. Boarding proofs are deterministic, so the provider derives
  the existing intent id from the signed proof transaction and reattaches the
  new event listener to that exact intent. A different output produces a
  different id and therefore cannot be confirmed by this path.

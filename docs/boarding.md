# VTXO boarding

`vault-board-v1` is a distinct L1 intermediate. Existing Spending outputs are
not arkd boarding outputs and are never advertised as if they were.

```text
L1 Spending routine spend
  -> confirmed vault-board-v1 output
    -> SDK settle to vault-policy-v1
```

The intermediate uses the SDK's standard boarding tree: device + Arkade
Operator before expiry, and device-only recovery after 604672 seconds. The
vault service publishes the exact address, script, program name, and delay.
The client reconstructs the tree from the device and Operator keys and refuses
any mismatch before funding or signing it.

Savings is never a boarding source. The settlement output is explicitly the
`vault-policy-v1` Arkade address; SDK default change is not accepted.

## SDK observations

- `Wallet.create()` always constructs `DefaultVtxo` as its receive contract.
  It does not accept a custom offchain tapscript. Boarding therefore calls
  `wallet.settle()` with an explicit `vault-policy-v1` output instead of using
  parameterless settle, which would create a default VTXO.
- The SDK's background boarding poll requires a continuously available signing
  `Identity`. The vault's device key is PRF-wrapped and only exists in memory
  after a user verification ceremony. The app can finish automatically while
  the initiating page remains open; after suspension or reload, the confirmed
  intermediate is detected and `Finish boarding` asks for Face ID again.
- `settlementConfig: false` is required for this coordinator. Otherwise the
  SDK manager may race the explicit policy-directed settle with its own
  parameterless default-output settle.
- A boarding settlement can outlive an ordinary HTTP request because it waits
  on the Operator event stream. The Arkade same-origin route must remain a
  direct streaming rewrite rather than a buffered serverless function.

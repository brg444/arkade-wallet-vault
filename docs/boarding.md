# VTXO boarding

`vault-board-v1` is the onchain entry into Spending. Spending contains VTXOs;
the boarding output is a temporary Bitcoin output that the official Arkade SDK
settles into the enrolled `vault-policy-v1` contract.

```text
Savings spend or onchain receive
  -> vault-board-v1 output appears as pending Spending
    -> output confirms on Bitcoin
      -> Face ID unlocks the device key for one settlement attempt
        -> SDK settle creates vault-policy-v1 VTXOs
```

The Spending receive view publishes one BIP21 request containing the Arkade
address and the boarding address. An Arkade-aware sender creates a VTXO
directly. An onchain sender funds the boarding address. Moving Savings to
Spending uses the same address, so it enters the same settlement lifecycle.

The displayed Spending balance includes unspent boarding outputs as soon as
they are observed. Those outputs remain pending and cannot fund a send or a
Lightning payment. Only indexed, unspent `vault-policy-v1` VTXOs are
spendable. Once the destination VTXOs are observed, their batch result takes
precedence over delayed Esplora state so the same value is not counted twice.

## Contract and policy checks

The boarding output uses the SDK boarding tree: device plus Arkade Operator
before expiry, and device-only recovery after 604672 seconds. The Vault service
publishes the exact address, script, program name, and delay. The client
reconstructs the tree from the device and Operator keys and refuses a mismatch
before funding or signing.

The settlement output is the exact enrolled `vault-policy-v1` Arkade address.
`settlementConfig: false` disables the SDK's default settlement destination,
which would otherwise create an ordinary SDK VTXO. A custom Contract Manager
handler reconstructs the enrolled contract and marks it as unavailable to
generic SDK spend, renewal, and sweep selection.

The server recognizes only the advertised `vault-board-v1` script as an
internal transfer. Its L1 fee counts toward the rolling allowance, while its
principal is debited once, when a later VTXO payment leaves Spending.

## Observation and Face ID

The official SDK repositories, Contract Manager, Message Bus, and read-only
service-worker wallet maintain VTXO and intent state. Each vault has an opaque
worker scope, message tag, wallet database, contract database, and intent
database. Switching vaults does not reuse another vault's identity or data,
and ordinary switching does not unregister a worker that another tab may still
use.

The persistent worker receives only the compressed device public key through
`ReadonlySingleKey`. It can watch contracts, refresh balances, and notify the
page, but it cannot sign or settle. The PRF-derived private scalar is available
only in the foreground after Face ID. One per-vault Web Lock excludes another
tab while the page creates a short-lived SDK wallet, settles the confirmed
boarding output, closes the wallet and repositories, and zeroes the source
secret.

A page or process interruption during signing discards that session. The next
attempt requires Face ID again. This preserves the device-key boundary; the
wallet does not serialize the scalar, a MuSig session, or an unlocked identity
to IndexedDB, local storage, or the service worker.

## Retry and reconciliation

The SDK intent repository records settlement progress for each boarding
outpoint. A nonterminal request, or a terminal request that reports retained
Operator state, blocks another automatic attempt for that outpoint. It never
ages back into a retry on a local timer. A different confirmed outpoint remains
eligible and is settled separately, so one interrupted request does not block a
later deposit or bind it to the same request.

The read-only worker can observe these records and public chain state, but it
cannot resume a lost signing session. Delegate support starts with an existing
VTXO and cannot sign a raw boarding output. The foreground therefore gives one
exact eligible output to `Wallet.settle()` after Face ID. The SDK owns proof
construction, registration, event handling, and intent persistence.

Confirmed destination evidence always wins over stale local metadata. Missing
events, worker suspension, offline periods, and focus changes trigger bounded
reload and reconciliation from the SDK repositories and public data sources.
Events improve responsiveness but are not the sole source of truth.

Vault code does not implement registration proofs, replay Operator messages,
infer private Operator state, or add lifecycle endpoints to arkd. It supplies
one confirmed onchain input and the exact policy output to `Wallet.settle()`;
the deployed Arkade Operator remains authoritative for batch state.

The current Mutinynet Operator returns no match when SDK duplicate recovery
tries to delete a retained boarding-only intent. The wallet therefore keeps
that output visible and pending without repeatedly reopening Face ID. It can
proceed after Operator cleanup or recover with the device key once the
604672-second exit delay matures. Hardware alone is not part of the boarding
recovery path.

## Release qualification

Browser qualification covers service-worker activation and updates, A-to-B-to-A
vault switching, simultaneous vaults in separate tabs, offline recovery, lost
events, and interruption at each settlement state. Live Mutinynet qualification
also covers both propagation orders: the VTXO may appear before Esplora removes
the spent boarding output, or Esplora may update first.

Generic VTXO renewal and two-party unilateral exit remain separate release
gates. The custom contract handler intentionally prevents generic SDK paths
from selecting Vault Program funds until those paths are specified and tested.

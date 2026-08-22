# Architecture

Arkade Vault has three active runtime roles:

```text
browser wallet
  -> same-origin /v1 -> Vault service
  -> same-origin Arkade routes -> Arkade Operator
  -> Bitcoin data routes -> Esplora and the Arkade indexer
```

| Role            | Authority                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser wallet  | Holds the wrapped phone key, builds transactions, verifies server facts, requests user authorization, and coordinates external signatures. |
| Vault service   | Holds the tenant VaultCosigner, immutable Vault Program record, authenticated allowance ledger, and policy sequence.                       |
| Arkade Operator | Coordinates VTXO batches and supplies the Operator signatures pinned by the release.                                                       |

The wallet and service independently rebuild every current program from public
enrollment facts. Neither side accepts an address, script, checkpoint closure,
or signing role merely because another component supplied it.

## Application boundary

`src/index.tsx` composes the Vault-only application. `VaultApp.tsx` owns
navigation, `src/providers/vault.tsx` coordinates authenticated application
state, `src/screens/Vault` contains the user flows, and `src/lib/vault`
contains program construction, transaction validation, persistence adapters,
and VTXO lifecycle coordinators. The production graph excludes the deleted
general-wallet entrypoint and its unrelated swaps, assets, notes, lending, and
generic Lightning integrations.

Each VTXO send has a client-generated operation ID that is persisted before
the first mutation. The phone signs the canonical reserve request before the
wallet contacts the service. Later authorization, checkpoint, submission, and
finalization stages all reconcile through that server operation after a lost
response.

SDK wallet and contract data use a versioned IndexedDB database per vault.
Intent state uses a separate per-vault database. Ordinary send recovery uses a
versioned local record bound to the same vault, destination, amount, and
operation ID.

## Trust boundary

The same-origin gateway secret authenticates the web deployment to the private
service; it is not user authorization. Passkey proofs, phone signatures, and
complete transaction verification authorize user mutations. The Vault service
and its ledger remain one protected component so the VaultCosigner cannot sign
without observing authoritative allowance state.

The current build is Mutinynet-only. It has no mainnet Operator, checkpoint,
delay, or network defaults.

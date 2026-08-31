# Upstream alignment

The Vault wallet treats the official Arkade Wallet and TypeScript SDK as the
reference implementation for VTXO storage, Contract Manager behavior, worker
updates, settlement, intents, and Operator communication.

The architecture review used these exact sources:

| Source                  | Reviewed revision                          | Vault dependency         |
| ----------------------- | ------------------------------------------ | ------------------------ |
| `arkade-os/wallet`      | `60cc144604db0c835888977548c7f7c8a330d765` | Reference implementation |
| `arkade-os/ts-sdk`      | `57d517b1fa85d3a32736215ecf9fed86c43e25eb` | `@arkade-os/sdk` 0.4.65  |
| `arkade-os/ts-swap-sdk` | Published package                          | `@arkade-os/swap` 0.0.8  |

Unmerged Wallet branches can inform tests and future compatibility work. The
release baseline remains the official revision in the table. Each dependency
update requires a new comparison against the corresponding official Wallet
integration and the Vault-specific invariants below.

## Intentional Vault extensions

The Vault Program uses `vault-policy-v1`, which is not the SDK's default VTXO
contract. A small custom Contract Manager handler reconstructs that exact
script and declares it unavailable for generic spending. Boarding calls the
published `Wallet.settle()` interface with an explicit policy destination and
`settlementConfig: false`.

The official worker architecture is retained with a stricter identity boundary.
The Vault worker uses `ServiceWorkerReadonlyWallet` and `ReadonlySingleKey`, so
it can observe public contract state without storing the Face ID-protected
device scalar. Signing uses a short-lived foreground `Wallet` under a per-vault
Web Lock.

Per-vault worker scopes, message tags, and IndexedDB names prevent two enrolled
vaults from sharing identity or lifecycle state. These are isolation adapters
around published SDK primitives, not a fork of the Operator protocol.

## Update checks

An SDK or Wallet update is accepted only after tests confirm:

1. the custom contract remains excluded from generic spend, renewal, and sweep;
2. `ReadonlySingleKey` never exposes a signing path;
3. worker messages and storage remain isolated across vaults and tabs;
4. `Wallet.settle()` preserves the explicit `vault-policy-v1` destination;
5. intent persistence and duplicate cleanup require no private Operator API;
6. the SDK does not copy or persist the PRF-derived scalar beyond the bounded
   foreground operation;
7. pending boarding value is displayed once, while only indexed VTXOs are
   spendable.

Upstream changes that alter any of these properties require a reviewed adapter
change or a Vault Program release. Vault code does not patch arkd or depend on
unpublished Operator endpoints.

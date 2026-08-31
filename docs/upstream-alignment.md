# Upstream alignment

The Vault wallet treats the official Arkade Wallet and TypeScript SDK as the
reference implementation for VTXO storage, Contract Manager behavior, worker
updates, settlement, intents, and Operator communication.

The architecture review used these exact sources:

| Source                  | Reviewed revision                            | Vault dependency                                   |
| ----------------------- | -------------------------------------------- | -------------------------------------------------- |
| `arkade-os/wallet`      | `9e57e8ef2d05eb1f0831ccf91b4e98cc199ba3a9`   | Reference implementation                           |
| `arkade-os/ts-sdk`      | Runtime `27f5c758`; PR validation `6e2b9ff1` | One exact Git-pinned `@arkade-os/sdk` 0.4.66 graph |
| `arkade-os/ts-swap-sdk` | Published package                            | `@arkade-os/swap` 0.0.8 using the same SDK graph   |

Unmerged Wallet branches can inform tests and future compatibility work. The
release baseline remains the official revision in the table. Each dependency
update requires a new comparison against the corresponding official Wallet
integration and the Vault-specific invariants below.

## Intentional Vault extensions

The Vault Program uses `vault-policy-v1`, which is not the SDK's default VTXO
contract. A small custom Contract Manager handler reconstructs that exact
script and declares it unavailable for generic spending.

The wallet uses the official SDK's named boarding-program and
worker-owned-identity seams. The persistent SDK Wallet,
Contract Manager, VtxoManager, repositories, batch lifecycle, settlement, and
retry loop live in the dedicated worker. Vault code adds deterministic key
provisioning, exact program reconstruction, a fixed Spending destination, and
one typed VaultBoardCosigner phase adapter.

The candidate SDK seam is maintained in
[`arkade-os/ts-sdk#802`](https://github.com/arkade-os/ts-sdk/pull/802). The wallet
pins commit `27f5c758` until that work is merged and released. Both the direct
SDK dependency and the swap package resolve to that same build.

Per-vault worker scopes, message tags, and IndexedDB names prevent two enrolled
vaults from sharing identity or lifecycle state. These are isolation adapters
around published SDK primitives, not a fork of the Operator protocol.

## Update checks

An SDK or Wallet update is accepted only after tests confirm:

1. the custom contract remains excluded from generic spend, renewal, and sweep;
2. the worker-owned identity never crosses `postMessage`;
3. worker messages and storage remain isolated across vaults and tabs;
4. the SDK settlement path preserves the exact `vault-policy-v1` destination;
5. intent persistence and duplicate cleanup require no private Operator API;
6. the SDK does not receive or persist the PRF-derived phone scalar, and the
   boarding key remains scoped to its vault, network, and named program;
7. pending boarding value is displayed once, while only indexed VTXOs are
   spendable.

Upstream changes that alter any of these properties require a reviewed adapter
change or a Vault Program release. Vault code does not patch arkd or depend on
unpublished Operator endpoints.

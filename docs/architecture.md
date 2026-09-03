# Architecture

Vaulted has three active runtime roles:

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
general-wallet entrypoint and its unrelated swaps, assets, notes, and lending.
The disabled Lightning send adapter delegates invoice, RFQ, VHTLC, and contract
registration to `@arkade-os/swap`; it does not create another wallet or
transaction lifecycle.

Each VTXO send has a client-generated operation ID that is persisted before
the first mutation. The phone signs the canonical reserve request before the
wallet contacts the service. Vault-service authorization, checkpoint, and
receipt responses reconcile through that server operation after a lost
response. Before the first Operator submission, the wallet also persists a
phone-and-VaultCosigner proof for the exact reserved inputs. If the submission
response is ambiguous, the wallet uses the official SDK pending-transaction
interface to recover the exact transaction and checkpoints. It never submits
the operation a second time. An empty or mismatched result remains locked for
manual resolution.

SDK wallet and contract data use a versioned IndexedDB database per vault.
Intent state uses a separate per-vault database. Ordinary send recovery uses a
versioned local record bound to the same vault, destination, amount, and
operation ID.

VTXO state follows the official SDK worker architecture. Each enrolled vault
has an opaque service-worker scope and message tag, plus isolated wallet,
contract, and intent databases. The worker registers the exact
`vault-policy-v1` Spending contract and publishes contract, balance, activity,
and UTXO updates to the page.

The sole `vault-board-v1` program uses the SDK's worker-owned identity mode. A
deterministic boarding key is derived only after the existing PRF unlock
succeeds, bound to the vault, network, and named program, and stored in a
separate per-vault IndexedDB database. The key never crosses `postMessage`.
Inside the worker, the official SDK owns Wallet, Contract Manager, VtxoManager,
intent persistence, batch participation, settlement, polling, and retry. The
page owns no parallel boarding lifecycle.

The SDK's generic spend, renewal, and sweep paths cannot select
`vault-policy-v1` VTXOs. A custom Contract Manager handler reconstructs the
enrolled script and declares it unavailable for generic spending. Vault sends
continue through the transaction-bound VaultCosigner authorization flow.

The boarding adapter is narrower than the Spending cosigner API. It prepares
one exact confirmed input and fixed Spending recipient, verifies and submits
registration or release proofs, and verifies SDK-validated final batch
evidence. The Vault service never returns its boarding signature. It calls only
the stock public Operator endpoints, so the architecture requires no modified
`arkd` or private Operator lifecycle API.

Onchain Savings and recovery use `@scure/btc-signer` for Bitcoin addresses,
Taproot, PSBTs, signing, and finalization. A narrow Esplora adapter discovers
the fixed program outputs and broadcasts completed transactions. Vault code
owns only deterministic selection and the versioned Vault-specific transaction
shapes. The boundary stops before general onchain wallet behavior. Fee
estimation, descriptor discovery, reorg-aware transaction state, general coin
control, or address derivation require an established wallet engine such as
BDK or the corresponding implementation from Arkade Wallet.

## Trust boundary

The same-origin gateway secret authenticates the web deployment to the private
service; it is not user authorization. Passkey proofs, phone signatures, and
complete transaction verification authorize user mutations. The Vault service
and its ledger remain one protected component so the VaultCosigner cannot sign
without observing authoritative allowance state.

The release candidate is Mutinynet-only. Mainnet uses `https://arkade.computer`
through the official Arkade SDK. The confirmed Emulator endpoint is
`https://emulator.arkade.computer`; its advertised signer matches the SDK pin,
but the corresponding Contract Pack pins remain to be frozen and qualified.
Mainnet Vault Program and policy choices are a later release gate, not part of
the current lifecycle cleanup.

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

Onchain Savings and recovery use `@scure/btc-signer` for Bitcoin addresses,
Taproot, PSBTs, signing, and finalization. A narrow Esplora adapter discovers
the fixed program outputs and broadcasts completed transactions. Vault code
owns only deterministic selection and the versioned Vault-specific transaction
shapes. The boundary stops before general onchain wallet behavior. Fee estimation,
descriptor discovery, reorg-aware transaction state, general coin control, or
address derivation require an established wallet engine such as BDK or the
corresponding implementation from Arkade Wallet.

## Trust boundary

The same-origin gateway secret authenticates the web deployment to the private
service; it is not user authorization. Passkey proofs, phone signatures, and
complete transaction verification authorize user mutations. The Vault service
and its ledger remain one protected component so the VaultCosigner cannot sign
without observing authoritative allowance state.

The current build is Mutinynet-only. Mainnet uses `https://arkade.computer`
through the official Arkade SDK. The private mainnet Emulator endpoint and the
corresponding Contract Pack pins remain to be configured. Mainnet Vault Program
and policy choices are a later release gate, not part of the current lifecycle
cleanup.

# Lightning send

Outbound BOLT11 uses the published `@arkade-os/swap` package to request and
verify an Arkade-to-Lightning quote. The package decodes the invoice facts,
derives the VHTLC, checks the solver's lockup address, and registers the
contract with the official Arkade SDK before any funding transaction is built.

The Vault adapter opens a standard SDK wallet with the enrolled phone identity
and the existing per-vault SDK repositories. It changes only `getAddress()` so
the package commits every refund to the exact `vault-policy-v1` Spending
address. The adapter verifies that address against the signed enrollment
binding, advertised Spending script, network, and Operator signer. A standard
swap repository and `RfqSwapManager` own restart, resolution, and refund state.
The adapter closes the temporary manager, wallet, and repositories after each
bounded wallet operation.

Funding remains an ordinary Vault VTXO send to the package-verified lockup
address. The Vault service applies the same per-transaction cap, rolling
allowance, fee bounds, input reservation, transaction verification, and
ambiguous-submission recovery used for every other Spending transfer. It does
not expose Lightning-specific routes or reinterpret the VHTLC.

## Durable send lifecycle

The wallet stores the package RFQ record and complete recovery profile before
it reveals a funding target. The record includes:

- invoice and locally decoded amount, payment hash, network, and expiry;
- RFQ identifier, solver identity, and signed solver card identity;
- quote validity, refund locktime, funding amount, and corridor fee;
- lockup address, VHTLC script, and exact `vault-policy-v1` refund address;
- SDK contract-registration identity, sender signing descriptor, and funding
  transaction identity when one exists.

The invoice and quote are checked again immediately before funding. A quote
that expires before the user authorizes the ordinary VTXO reservation must be
discarded without creating a second operation. An ambiguous funding response
resumes through the existing VTXO operation and the official SDK
pending-transaction interface.

The package manager restores nonterminal records during an authorized wallet
session. A read-only manager pass also reconciles records during balance
refresh and window focus. It uses the package activity reader to recover a
funding transaction identity when the local response was lost. An unfunded
quote can be cancelled or retired after expiry. Once funding starts, the record
remains until the payment settles or refunds because an absent broadcast
response does not prove that no funds moved.

## Refunds

The package manager uses the published Arkade refunder for unresolved funded
records and returns value directly to `vault-policy-v1`. A read-only refresh
can identify a payment that is ready to return, but producing the refund
signature requires the passkey-backed phone key. The transaction screen then
offers `Return to Spending`. Package-level tests rebuild the persisted contract
and verify that its refund leaf contains the exact Spending script.

Mainnet enablement still requires immediate-failure and delayed-refund tests
against the approved service and solver configuration.

## Lightning receive

Lightning receive is not part of this release. The published package contains
the client primitives, but the production solver registry currently exposes no
mainnet market for the route. The production covenant claim service is not
available through `arkade.computer`, and the online phone-plus-Operator claim
does not itself constrain the destination to `vault-policy-v1`. The official
wallet flow also does not provide the reload-safe receive lifecycle required by
a vault.

Receive remains disabled until a published package contains the current
receive fixes, the solver route and covenant claim service are deployed, and a
low-value proof confirms payment to the exact Spending script through reload,
underfunding, Operator outage, claim, solver refund, and unilateral recovery.

## Release gate

The send UI is available only when `VITE_VAULT_LIGHTNING_SEND` is exactly
`true`. The current release also requires the pinned Mutinynet solver profile,
so another network fails closed. Mutinynet qualification requires a real
invoice to exercise quote, funding, settlement, reload, lost funding response,
expiry, and refund with bounded value.

Mainnet requires all of the following:

1. ordinary mainnet VTXO Spending is qualified against `arkade.computer`;
2. the mainnet Emulator and Vault Program pins are frozen;
3. one signed solver card, relay set, amount range, and rotation procedure are
   approved, because the public mainnet registry currently advertises no
   Lightning market;
4. quote expiry and ordinary reservation expiry are coordinated and covered by
   reload and lost-response tests;
5. the package RFQ record and VHTLC contract data have a portable recovery
   path. They currently live in browser IndexedDB, so a fresh browser cannot
   reconstruct a funded swap;
6. a real invoice exercises payment, immediate-failure refund, delayed status,
   and ambiguous funding recovery with bounded value.

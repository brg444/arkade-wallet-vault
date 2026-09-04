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

The package manager restores nonterminal records at startup. An unfunded quote
can be cancelled or retired after expiry. Once the funding target is exposed,
the record remains until the payment resolves or refunds because an absent
broadcast response does not prove that no funds moved.

## Refunds

The initial send posture matches the current Arkade Wallet integration. The
VHTLC's noninteractive refund path uses the server, solver, and mainnet
Emulator to return value directly to `vault-policy-v1`. Package-level tests
rebuild the persisted contract and verify that this leaf contains the exact
Spending script.

Reload and focus reconciliation are watch-only. They can recognize settlement
or show that a refund is available, but they cannot sign one. Returning an
expired payment to Spending requires a separate Face ID approval; only that
bounded operation installs the package refunder. Mainnet enablement still
requires real immediate-failure and delayed-refund tests against the approved
service and solver configuration.

## Lightning receive

Lightning receive is not part of this release. Arkade Wallet PR 918 is the
reference integration for persisted receive claims and cross-tab ownership,
but its reload, claim, and refund behavior has not completed live Mutinynet
qualification for the Vault.

Receive remains disabled until a published package contains the current
receive fixes, the solver route and covenant claim service are deployed, and a
low-value proof confirms payment to the exact Spending script through reload,
underfunding, Operator outage, claim, solver refund, and unilateral recovery.

## Release gates

The Mutinynet send UI is disabled unless `VITE_VAULT_LIGHTNING_SEND` is exactly
`true`. Its first deployment uses the bundled, signature-verified Mutinynet
solver card and the published SDK and swap packages. Lightning receive remains
disabled independently.

Mutinynet solver deployment, caps, and the remaining external operator
actions are in `docs/lightning-mutinynet-operator.md`.

Mainnet send enablement requires all of the following:

1. ordinary mainnet VTXO Spending is qualified against `arkade.computer`;
2. the mainnet Emulator and Vault Program pins are frozen;
3. one signed solver card, relay set, amount range, and rotation procedure are
   approved, because the public mainnet registry currently advertises no
   Lightning market;
4. quote expiry and ordinary reservation expiry are coordinated and covered by
   reload and lost-response tests;
5. a real invoice exercises pay, immediate failure refund, delayed status, and
   ambiguous funding recovery with bounded value.

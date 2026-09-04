# Mainnet v2 baseline

Vaulted is a dedicated Bitcoin wallet application. Arkade is the core
runtime/infrastructure, not the product name. Mainnet starts from fresh
application state and does not import Mutinynet wallets, credentials, or
in-flight operations.

## Production names

These names are the intended public surface. They are not live until DNS,
Vercel, and Guardian infrastructure are provisioned separately from Mutinynet:

| Role                     | Name                         |
| ------------------------ | ---------------------------- |
| Product                  | Vaulted                      |
| Marketing                | `https://getvaulted.xyz`     |
| Wallet                   | `https://app.getvaulted.xyz` |
| Runtime/Guardian ingress | `guardian.getvaulted.xyz`    |
| Release candidate        | `https://rc.getvaulted.xyz`  |

Mainnet WebAuthn RP IDs must equal the wallet hostname (`app.getvaulted.xyz` or
`rc.getvaulted.xyz`). Do not reuse the Mutinynet Vercel project, origin, RP ID,
gateway secret, rate-limit store, or browser storage.

## Current boundary

The production graph contains enrollment and passkey sign-in, VTXO Spending,
Savings, external PSBT handoff, recovery, the Recovery Kit, and the
authenticated public recovery map. Storage is versioned and isolated per
vault. Protocol versions remain only where bytes are persisted, signed, or
compared with the service.

Fresh enrollment writes one local `arkade-vault-program-pin-v1` record. Its
digest covers the vault identifier, network, complete Savings descriptor, and
every immutable Spending and boarding field. Later status reads must match the
record exactly, including after a reload or enrolled-to-unenrolled response.
There is no reader or migration path for the retired Savings-only pin.

One coordinator owns each durable Vault-service operation. A reload resumes a
VTXO send by its client-generated operation ID after an ambiguous Vault-service
response. The phone authenticates the reservation; later stages use server
compare-and-swap transitions. Before the first Operator submission, the wallet
persists a dual-signed proof bound to the exact reserved inputs. It submits
once, then uses the official SDK pending-transaction interface after an
ambiguous response. The recovered Arkade transaction and checkpoints must
match the persisted operation exactly. Arkade transaction construction,
boarding, and Operator communication remain inside the official SDK surface.

## Release order

1. Qualify ordinary VTXO receive and send, including reloads and lost responses.
2. Qualify Savings-to-Spending boarding and recovery drills.
3. Configure `https://mainnet-signer.invalid`, freeze its signer, the
   `vault-spending-policy-v1` bounds and presets, and the program pins for
   `arkade.computer`, then regenerate both Contract Packs and cross-language
   vectors.
4. Deploy with production key isolation, independent rollback-control storage,
   and shared durable edge limits.
5. Enable outbound BOLT11 after ordinary Spending is stable. The published
   swap package owns invoice, RFQ, VHTLC, and contract-registration semantics;
   funding uses the existing ordinary VTXO operation. Lightning receive
   remains a separate program and gate.

The compiled Vault Program remains fixed. Each fresh vault selects one
immutable policy instance within the reviewed mainnet bounds during
enrollment. Arbitrary policy execution and post-enrollment mutation remain out
of scope.

## Open mainnet gates

- Ordinary VTXO send supports fragmented multi-input balances, exact
  no-change sends, and bounded Operator fees. Live Mutinynet qualification must
  cover those shapes, reloads, dropped Vault-service responses, ambiguous
  Operator submissions, empty and mismatched pending lookups, checkpoint
  reordering, and concurrent attempts before the mainnet pins are frozen.
- `vault-board-v1` uses a worker boarding key and VaultBoardCosigner in the
  cooperative leaf, fixes settlement to the enrolled `vault-policy-v1`
  recipient, and keeps phone-only delayed recovery. Mainnet requires a separate
  per-device key registration and revocation decision.
- Mainnet pins must match `arkade.computer`, including its network, signer,
  checkpoint policy, delays, and fee bounds. The confirmed mainnet Emulator at
  `https://mainnet-signer.invalid` advertises signer
  `0239c196415da47b26456a101daaa12ba9e445bfe153197f1e2b750bf40e52092e`,
  which matches the official SDK pin; release qualification and immutable
  Contract Pack binding remain required.
- The wallet uses the official SDK lifecycle without custom registration,
  deletion, replay, event-stream, or Operator-status extensions.
- Boarding uses one persistent SDK Wallet in a dedicated service worker. Its
  scoped board key is provisioned only after PRF unlock and never crosses
  `postMessage`. The SDK owns intents, batch participation, settlement,
  persistence, and retries; Vault code supplies only the exact named program,
  fixed Spending destination, and typed VaultBoardCosigner phases.
- Response-loss recovery must pass prepare, register, release, and final
  interruption, worker suspension and wake, missed-event, retained-intent, and
  two-context qualification against the deployed public Operator API.
- Boarding and ordinary send require Web Locks and fail closed when the browser
  does not provide them. Mainnet qualification must define the supported
  browser boundary and cover deterministic two-context races.
- Supported hardware wallets must preserve and validate the custom tapscript
  PSBT. Hardware-only map recovery needs a standardized vendor adapter.
- Live Mutinynet qualification must cover reload, two-tab races, dropped
  reserve and authorization responses, missed event acknowledgements, lost
  finalization, and delayed recovery.
- Deployed browser qualification must cover scoped worker installation and
  updates, A-to-B-to-A vault switching, simultaneous vaults in separate tabs,
  offline recovery, lost worker events, and both VTXO-first and Esplora-first
  propagation.
- Outbound BOLT11 is implemented as a disabled package-native lifecycle using
  the published RFQ repository, manager, contract registry, and refunder.
  Mainnet enablement still requires an approved signed solver card and rotation
  procedure, quote-to-reservation expiry tests, and real invoice and refund
  tests. The public mainnet solver registry currently advertises no Lightning
  market.
- Lightning receive remains disabled. The route needs a published package with
  the current receive fixes, a deployed mainnet solver market, a production
  covenant claim service, reload-safe client state, and proof that every claim
  pays the exact `vault-policy-v1` Spending script.
- The signed recovery binding must include every immutable Spending and
  boarding field. A refund address received only from mutable status is not an
  acceptable Lightning destination pin.
- The production dependency graph must pass `pnpm audit --prod`. The reviewed
  `ws` override stays pinned until the official SDK dependency resolves to the
  patched release directly.

Mainnet constants require explicit values, with all Mutinynet defaults excluded
from that configuration.

## Candidate profile status

The candidate profile now pins the mainnet Operator, Emulator, checkpoint,
program delays, Arkade HRP, and Contract Pack independently from Mutinynet.
The mainnet Vercel manifest builds a network-bound bundle, uses the mainnet
Esplora route, excludes Mutinynet origins from CSP, and fails closed unless a
shared durable gateway counter is configured. This closes configuration work;
it does not close the live lifecycle, hardware, storage-audit, upstream
Emulator package, licensing, or staged-release gates above.

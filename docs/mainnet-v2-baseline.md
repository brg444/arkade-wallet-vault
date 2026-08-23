# Mainnet v2 baseline

This branch is a fresh Vault-only application. It does not migrate the
Mutinynet preview, preserve the inherited general Arkade wallet, or load old
Vault implementations behind compatibility switches.

## Current boundary

The production graph contains enrollment and passkey sign-in, VTXO Spending,
Savings, external PSBT handoff, recovery, the Recovery Kit, and the
authenticated public recovery map. Versioned per-vault storage replaces the
old global SDK databases.

The inherited wallet entrypoint, generic swaps and Lightning, assets, notes,
lending integrations, demo funding, regtest fixtures, v4/v5 readers, raw
private-key screens, and L1 Daily account have been removed. Protocol versions
remain only where bytes are persisted, signed, or compared with the service.

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
3. Configure the private mainnet Emulator endpoint, freeze the program pins for
   `arkade.computer`, then regenerate both Contract Packs and cross-language
   vectors.
4. Deploy with production key isolation, independent rollback-control storage,
   and shared durable edge limits.
5. Implement outbound BOLT11 as a separate durable saga only after ordinary
   Spending is stable. Lightning receive remains a separate program and gate.

Mainnet Vault Program parameters and policy adjustments begin at step 3. They
are intentionally outside the current Mutinynet reliability and cleanup work.

## Open mainnet gates

- Ordinary VTXO send supports fragmented multi-input balances, exact
  no-change sends, and bounded Operator fees. Live Mutinynet qualification must
  cover those shapes, reloads, dropped Vault-service responses, ambiguous
  Operator submissions, empty and mismatched pending lookups, checkpoint
  reordering, and concurrent attempts before the mainnet pins are frozen.
- The phone-plus-Operator boarding intermediate remains an explicit trust
  assumption until value reaches `vault-policy-v1`.
- Mainnet pins must match `arkade.computer`, including its network, signer,
  checkpoint policy, delays, and fee bounds. The private mainnet Emulator
  endpoint is the remaining unavailable external dependency.
- The wallet uses the official SDK lifecycle without custom registration,
  deletion, replay, event-stream, or Operator-status extensions.
- Automatic boarding excludes every outpoint held by the SDK intent
  repository before wallet creation. A retained nonterminal intent stays
  fail-closed when the deployed interface cannot prove completion or release;
  live qualification must define the operational resolution path.
- Boarding and ordinary send require Web Locks and fail closed when the browser
  does not provide them. Mainnet qualification must define the supported
  browser boundary and cover deterministic two-context races.
- Supported hardware wallets must preserve and validate the custom tapscript
  PSBT. Hardware-only map recovery needs a standardized vendor adapter.
- Live Mutinynet qualification must cover reload, two-tab races, dropped
  reserve and authorization responses, missed event acknowledgements, lost
  finalization, and delayed recovery.

Mainnet constants require explicit values, with all Mutinynet defaults excluded
from that configuration.

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

One coordinator owns each durable vault-service operation. A reload resumes a
VTXO send by its client-generated operation ID after an ambiguous HTTP
response. The phone authenticates the reservation; later stages use server
compare-and-swap transitions. Boarding registration persists its exact signed
request and keeps the inputs locked after an ambiguous response, but automatic
crash-and-reload replay remains a release gate.

## Release order

1. Qualify ordinary VTXO receive and send, including reloads and lost responses.
2. Qualify Savings-to-Spending boarding and recovery drills.
3. Freeze mainnet program identities, Operator policy, delays, and fee bounds,
   then regenerate both Contract Packs and cross-language vectors.
4. Deploy with production key isolation, independent rollback-control storage,
   and shared durable edge limits.
5. Implement outbound BOLT11 as a separate durable saga only after ordinary
   Spending is stable. Lightning receive remains a separate program and gate.

## Open mainnet gates

- Ordinary VTXO send supports fragmented multi-input balances, exact
  no-change sends, and bounded Operator fees. Live Mutinynet qualification must
  cover those shapes, reloads, dropped responses, checkpoint reordering, and
  concurrent retries before the mainnet pins are frozen.
- The phone-plus-Operator boarding intermediate needs a reviewed threat bound or
  a design that applies Vault policy before settlement.
- The Mutinynet 4,608-second VTXO exit pin has no mainnet approval. Mainnet
  Operator, checkpoint, network, delay, and rotation pins remain undefined.
- Candidate arkd changes delete boarding intents by boarding input, restore
  Redis confirmation queues atomically, and return the same identifier for an
  exact retained registration retry. An exact-identifier lifecycle endpoint
  also reports active batch identity and expiry for selected and in-progress
  intents. These changes must be upstream, released, deployed, and qualified
  against Redis before boarding is enabled. Exact registration retry currently
  lasts only while the intent is live or selected.
- Candidate SDK changes persist the exact registration request before network
  submission, retain an ambiguous state, and commit the returned Operator
  intent ID before reporting success. Unreadable intent state fails closed, and
  nonterminal intent locks apply to ordinary settlement and boarding inputs.
  The changes must be upstream, released, pinned by the wallet, and extended
  with a restorable signing session and complete settlement snapshot. A reload
  must replay that exact request, rebuild the same batch handler, and reconcile
  every signing-stage event that the stream does not replay.
- Boarding and ordinary send require Web Locks and fail closed when the browser
  does not provide them. Mainnet qualification must define the supported
  browser boundary and cover deterministic two-context races.
- Supported hardware wallets must preserve and validate the custom tapscript
  PSBT. Hardware-only map recovery needs a standardized vendor adapter.
- Live Mutinynet qualification must cover reload, two-tab races, dropped
  reserve and authorization responses, missed event acknowledgements, lost
  finalization, and delayed recovery.

Mainnet constants require explicit values, with all Mutinynet defaults excluded
from that configuration. A blocked gate remains a visible release condition;
user-facing retry copy never closes it.

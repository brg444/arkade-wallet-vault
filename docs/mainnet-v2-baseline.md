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

One coordinator owns each durable operation. A reload resumes the same identity
and exact request after an ambiguous HTTP response. The VTXO reservation now
uses a client-generated operation ID and phone signature; later stages use
server compare-and-swap transitions.

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
- arkd must delete boarding intents by boarding input and restore Redis
  confirmation queues atomically.
- The SDK or provider must durably retain the returned Operator intent ID before
  reporting registration success, while reconnect needs a read-reconcile path
  for batch events that the stream does not replay.
- Boarding and ordinary send require a durable cross-context lease or an
  explicit fail-closed requirement for browsers without Web Locks.
- Supported hardware wallets must preserve and validate the custom tapscript
  PSBT. Hardware-only map recovery needs a standardized vendor adapter.
- Live Mutinynet qualification must cover reload, two-tab races, dropped
  reserve and authorization responses, missed event acknowledgements, lost
  finalization, and delayed recovery.

Mainnet constants require explicit values, with all Mutinynet defaults excluded
from that configuration. A blocked gate remains a visible release condition;
user-facing retry copy never closes it.

# Mainnet v2 baseline

This branch becomes a Vault-only application. It does not migrate the Mutinynet
demo, preserve the general Arkade Wallet, or keep inactive versions behind
feature flags.

## Application boundary

The production dependency graph starts at `src/vault-index.tsx` and contains
only:

- enrollment and passkey sign-in;
- Spending VTXO receive, send, boarding, history, and recovery;
- Savings receive, spend, hardware handoff, and recovery;
- the Recovery Kit and authenticated public recovery map;
- the shared UI primitives actually used by those flows.

The following code is deleted from this branch once imports are severed:

- the inherited general-wallet entrypoint, providers, screens, service worker,
  and application integrations;
- Boltz swap, asset, note, Nostr, lending, Branta, and generic Lightning code;
- regtest fixtures, demo funding, preview balances, demo keys, and test faucets;
- v4/v5 compatibility readers and version-named directories;
- legacy onchain Spending balance and transaction paths.

Version strings remain only at protocol boundaries: the release manifest,
stored records, signed digests, and conformance vectors. They do not determine
which implementation module is loaded.

## Modules

`app` owns composition and navigation. `features` owns enrollment, Spending,
Savings, and recovery workflows. `domain` contains pure Vault Program and
transaction validation. `infrastructure` contains HTTP, WebAuthn, IndexedDB,
Esplora, and Arkade Operator adapters. UI components do not call infrastructure
directly.

One coordinator owns each durable operation. A reload resumes the same
operation by its persisted identity; it never creates a replacement operation
because an HTTP or event-stream response was lost.

## Release order

1. ordinary VTXO receive and send;
2. Savings-to-Spending boarding using the same boarding address returned on the
   Spending receive request;
3. recovery and failure drills;
4. outbound BOLT11 Lightning as a separate durable operation;
5. Lightning receive only after its independent contract and denial-of-service
   posture are approved.

Mainnet program constants stay unimplemented until the Operator, signer keys,
delay units, fee bounds, and rotation policy are frozen. Mutinynet constants
must not silently become mainnet defaults.

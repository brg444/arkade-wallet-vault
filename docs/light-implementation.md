# Vaulted Light implementation

Status: enrollment and wallet integration candidate, September 5, 2026. **Not ready for a Light-enabled mainnet deployment.** Renewal and funded recovery qualification remain required.

The `vaulted-light-v1` profile uses `vault-light-policy-v1` Spending with immutable per-payment and rolling 24-hour limits. Standard and Advanced keep their existing keys, descriptors, recovery paths, and authenticated ledger records.

## Implemented behavior

The wallet and Go runtime independently reconstruct the same two-leaf contract. Cooperative payments require the owner, Vault policy cosigner, and stock Arkade Operator. The owner can use the separate Bitcoin exit after the release-pinned delay; this emergency path does not enforce ordinary payment limits.

Light enrollment creates a resident PRF-capable passkey and an independent owner key. The runtime validates the WebAuthn ceremony, derives a Light-scoped cosigner, binds the exact policy and descriptor, and atomically consumes the admission token. The shared invitation setting applies: `VAULT_INVITE_ONLY=false` issues a short-lived admission session without a manual invitation.

Owner-key backups use separate AES-GCM envelopes for the passkey PRF and a random 32-byte recovery secret. Enrollment requires reopening the saved file and decrypting its owner key with the saved secret before completion. An unfinished setup survives reload with encrypted material only; the recovery secret must already have been saved separately. Confirmed expiry offers an explicit restart, while a completed ceremony still replays its original wallet after a lost response. Ordinary restoration requires the original passkey and matching saved descriptor.

The Spending screen uses the existing reservation, authorization, checkpoint, reconciliation, and activity machinery. Light's service worker receives only its public descriptor and rejects signing requests. The UI exposes direct Arkade receipt and payments, plus a separate watch-only Bitcoin address for Savings. An unavailable Savings update clears the previous balance.

Emergency recovery can prepare an owner-signed SDK graph package for the current outputs and execute a previously prepared package through Bitcoin explorer requests. The package signature binds its complete contents, descriptor, destination, and fee address. Completion requires confirmation of every prepared sweep; an exhausted SDK iterator with failed branches cannot produce a success notice. These implementation paths still require a funded exit drill.

## Rollout and binaries

The new runtime binary defaults `VAULT_LIGHT_ENABLED` to `false`. Setting it to `true` advertises Light in `supportedSetups` and allows new Light enrollment starts. Disabling it later preserves already-started ceremonies and existing Light wallets. This switch is independent of `VAULT_INVITE_ONLY`.

The wallet displays the three setup choices only when the runtime advertises Light. Mainnet and Mutinynet Vercel configurations route Light enrollment through the existing flat gateway function. A wallet build and updated runtime binary are required; this candidate makes no hardware firmware change and requests no stock Operator binary change.

The vendored SDK remains at the reviewed Vaulted lineage documented in `node_modules/@arkade-os/sdk/ORIGIN.md`. Replacing it with a published package would discard required boarding changes. Any SDK extension must retain the selective Lightning patches as well.

## Verification

- Shared wallet/Go vectors cover both release networks, scripts, control blocks, policy digests, and descriptor hashes.
- Runtime tests cover open and invite-only enrollment, frozen identities, restart, lost responses, protected change, per-payment limits, authenticated payment signing, and Light-specific key derivation.
- Wallet tests reject cross-profile substitutions, corrupted backups, wrong secrets, invalid imported keys, altered exit packages, and incomplete recovery execution.
- The HTTPS browser test uses a real Chromium virtual PRF passkey against the Go application, with an isolated Operator fixture. It covers file verification, reload during setup, enrollment, worker balance loading, Receive, reload/unlock, Security, and narrow-screen dark mode. It does not fund a live test-network wallet.
- The integration candidate passed 912 wallet unit tests before the additional enrollment-expiry check; that check also passes. Type checking, wallet lint, mainnet build, runtime full tests, runtime race checks, and Go lint passed. The runtime vulnerability scan found no affected call paths. Live mainnet dependency pins were verified separately.

The HTTP compatibility golden intentionally adds Light enrollment DTOs, three routes, optional Light status fields, and the public setup list. Existing Contract Pack and cryptographic vectors remain byte-identical; the ledger schema is unchanged.

## Funded contract drill

A fresh Mutinynet Light script received 50,000 test sats. The application prepared a complete owner-signed graph package for that output. A separate disposable SDK wallet supplied confirmed Bitcoin fee funds after the faucet's onchain route failed. The saved-package executor confirmed all three prerequisite transactions and reached the owner-only timelock, while its network boundary rejected non-Bitcoin provider requests. The final sweep is still pending; this is partial qualification evidence, not a completed recovery drill.

A separate mobile Chromium drill then enrolled through the Go application with a real virtual PRF passkey, received 50,000 Mutinynet sats, and paid 10,000 sats through the real reservation, authorization, checkpoint, and finalization endpoints. The payment transaction is `ff9da7c269c6dd119e325e9f7be1b9cb3376670b929c3cc63f222a9c3d6bb55d`. Its initial test assertion matched two success headings and failed after the payment completed; the assertion now selects the main heading. A subsequent passing browser test prepared recovery of all 40,000 sats of protected change from the saved file and secret, without a passkey, and verified the runtime's 10,000-sat usage and 40,000-sat remaining allowance.

The repeatable tools and private-state requirements are documented in `tools/light-qualification/README.md`. These drills still leave renewal, process-restart qualification, and final sweep confirmation outstanding.

## Remaining release gates

Renewal needs a named, bounded authorization path for the owner and policy cosigner. The pinned SDK currently exposes the required remote phase interface for boarding, while Light renewal also needs independently verified registration, deletion, replacement Batch Output, and forfeit evidence. Renewal requires its own semantic authorization entry point, with funds staying under the enrolled Light script throughout the operation. Fee accounting, conflicting inputs, retries, crash recovery, and ambiguous submission outcomes need durable treatment.

Fresh Mutinynet qualification must cover funding, payment and change, concurrent actions, process restart, lost responses, stale watch balances, key restoration, renewal near expiry, and Bitcoin exit with the Vault service unavailable and with all passkeys lost. Recovery data must cover the current balance after receipt, payment, and renewal. A successful key-file download or unit test does not establish that coverage.

Merge and enable Light on RC only after these gates pass. The intended release target is `rc.getvaulted.xyz`; `app.getvaulted.xyz` is outside this rollout.

## Local browser check

From the runtime checkout, start the opt-in harness with Go 1.26.6:

```bash
VAULT_LIGHT_BROWSER_ADDR=127.0.0.1:18898 VAULT_LIGHT_BROWSER_ORIGIN=https://localhost:3119 go test ./internal/application -run '^TestLightBrowserHarness$' -v -count=1 -timeout=25m
```

From the wallet checkout:

```bash
node scripts/prepare-browser-tests.mjs
HTTPS=true VAULT_E2E_PORT=3119 VAULT_E2E_OPERATOR_PORT=18897 VAULT_LIGHT_BROWSER_API=http://127.0.0.1:18898 pnpm exec playwright test -c playwright.vault.config.ts light.test.ts --project='Mobile Chrome'
```

The harness binds loopback, uses ephemeral test keys and a temporary ledger, and stops after 20 minutes. HTTPS certificate relaxation belongs only to the local Playwright process; production origin validation remains intact.

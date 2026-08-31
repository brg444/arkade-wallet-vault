# Release qualification

Arkade Vault qualifies the standard SDK lifecycle and the Vault-specific
Face ID boundary separately. Browser automation exercises deterministic state
transitions without reproducing the Arkade Operator. Live Mutinynet tests cover
the SDK settlement, signing, and batch behavior against the deployed service.

## Automated gates

Run the complete local gate from a clean checkout:

```bash
pnpm test:unit
pnpm test:e2e
pnpm exec tsc --noEmit
pnpm lint
pnpm format:check
pnpm build
git diff --check
```

The unit suite covers Vault Program construction, Savings PSBT signing and
handoff, policy authorization, VTXO selection, balance and history reduction,
boarding reconciliation, Lightning state, and local persistence boundaries.

The Playwright suite uses a CTAP 2.1 resident, user-verifying authenticator with
the PRF extension. It verifies enrollment, session lock and unlock, a cancelled
prompt followed by retry through the same button, credential mismatch, and
reloads on both sides of PRF derivation. Its secret audit rejects any
PRF-derived scalar found in local storage, session storage, IndexedDB, Cache
Storage, or messages sent to the service worker.

The same suite installs the production classic service worker and exercises
per-vault scopes, two simultaneous vaults, offline recovery, missed events,
persisted SDK intent states, and the transition from a visible boarding output
to an indexed VTXO without double counting. Rendered-wallet tests cover the
Spending BIP21 request, confirmed and pending balances, history, spendable
balance separation, and the persistent Savings hardware-PSBT handoff.

The deterministic Operator fixture implements public read-only responses only.
It does not emulate registration, MuSig2, settlement, or batch finalization.
Those behaviors remain owned by the published SDK and deployed Arkade
Operator, and they are qualified on Mutinynet.

## Face ID gate

The virtual authenticator proves WebAuthn and PRF application behavior; it is
not a substitute for the iPhone Face ID implementation. Every release candidate
must also pass on a physical iPhone in Safari and as an installed PWA:

1. Enroll a new vault and create the resident passkey after Face ID.
2. Lock the session, reload the page, and unlock with the same passkey.
3. Cancel Face ID once, then use the same unlock button to reopen the system
   chooser and complete the ceremony.
4. Open a fresh Safari context with no application storage and recover the
   enrolled vault through the resident passkey.
5. Interrupt the page before PRF completion and retry. No session may appear.
6. Interrupt the page after PRF completion but before the Vault service
   responds. Reloading must remain locked and require Face ID again.
7. Start boarding in two tabs. Only the tab holding the per-vault lock may ask
   for Face ID or create a signing wallet.
8. Background, terminate, and reopen the PWA during observation. The read-only
   worker may recover state without Face ID, but signing must require a new
   ceremony.

The worker must receive only the compressed device public key. Any private
scalar, unlocked signer, resumable MuSig2 session, or biometric-bypass behavior
in worker or persistent storage blocks release.

## Live Mutinynet gate

Use a newly enrolled vault and record transaction identifiers for each case.
The current deployed Arkade Operator and published SDK are authoritative.

1. Receive through the combined BIP21 request using both the Arkade address and
   the Bitcoin boarding address.
2. Confirm that an onchain deposit appears immediately as pending Spending,
   contributes to the displayed balance, and cannot fund a payment.
3. Leave the wallet open through settlement. Confirm that Face ID is requested
   only for the foreground signing attempt and that the indexed VTXO replaces
   the boarding value exactly once.
4. Repeat with reload, offline and reconnect, PWA backgrounding, two tabs, a
   missed worker event, and process termination before and after signing.
5. Exercise both propagation orders: destination VTXO first and spent boarding
   output first. Balance and history must remain stable in either order.
6. Move Savings to Spending with the persisted phone-signed PSBT, complete it
   with the exact hardware signature, and verify the same boarding lifecycle.
   A PSBT from another operation must be rejected.
7. Send VTXOs with exact input, change, no-change, fragmented input, ambiguous
   response, reload, and completed-change-already-spent cases. Only indexed
   VTXOs count as spendable.
8. Exercise outbound Lightning quote, payment, ambiguous funding, expiry, and
   refund after the Lightning release gate is enabled. Funding and refunds must
   remain bound to the enrolled Spending program.

No successful local simulation can waive a failed live settlement, worker
recovery, physical Face ID, or balance-convergence case.

## Failure evidence

A failed live case records the vault identifier, browser and installation mode,
SDK version, Operator URL, boarding outpoints, intent identifiers available
through the SDK repository, Arkade transaction identifier, checkpoint
identifiers, and the last confirmed application state. Private keys,
PRF-derived values, passkey assertions, raw hardware secrets, and enrollment
tokens must never appear in the report.

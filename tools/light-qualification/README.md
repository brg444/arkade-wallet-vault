# Funded Light contract recovery drill

This opt-in tool funds a fresh Mutinynet Light script and exercises the application's recovery implementation with the pinned SDK. It does not perform runtime enrollment, policy-authorized payments, or renewal, so its result covers contract recovery only.

The tool creates random test keys and saves them in a private directory before requesting faucet funds. Nothing from that directory belongs in Git or a build artifact. Every action rejects non-Mutinynet state. Use a new absolute directory for a new drill and retain it until the recovered test funds have been accounted for.

```bash
node tools/light-qualification/build.mjs
export VAULT_LIGHT_DRILL_DIRECTORY=/absolute/private/test-directory
node .vault-browser-tests/light-drill.mjs prepare
node .vault-browser-tests/light-drill.mjs fund-fees
node .vault-browser-tests/light-drill.mjs execute
```

`prepare` requests 50,000 test sats once, discovers the actual output, and prepares an owner-signed exit package. It prints the Bitcoin fee address and estimated costs. Repeated preparation reuses the funded state and replaces the package, so wait until the active exit has stopped before preparing again.

`fund-fees` requests 10,000 test sats onchain. When that faucet route is unavailable, `offboard-fees` uses a separate disposable SDK wallet to receive 10,000 test sats and settle them to the fee address. Light outputs remain in their own contract. This command needs Node's EventSource support:

```bash
node --experimental-eventsource .vault-browser-tests/light-drill.mjs offboard-fees
```

Funding and submission attempts are recorded before dispatch. An uncertain attempt stops automatic repetition. Inspect the saved operation and provider state before retrying it; a failed HTTP response does not establish that no transaction was submitted.

`execute` reads the saved file and secret and rejects every network request outside the Mutinynet Bitcoin explorer. It records public execution events and request URLs in `events.json`, preserving the distinction between broadcasts, timelock waits, failures, and confirmed sweeps. Interrupting it stops iteration; executing the same file again resumes by checking the chain.

`status` reports the script's indexed outputs. Completion requires every sweep to confirm and the destination to receive the expected amount. Preserve transaction IDs and relevant logs as qualification evidence, while keeping the saved keys private.

## Funded mobile browser check

`playwright.light-live.config.ts` runs only with `VAULT_LIGHT_LIVE=mutinynet` and an absolute `VAULT_LIGHT_DRILL_DIRECTORY`. Its loopback HTTPS application uses the real public Mutinynet Operator and Bitcoin explorer. The Go browser harness must use `VAULT_LIGHT_BROWSER_LIVE=mutinynet`, address `127.0.0.1:18899`, and origin `https://localhost:3120`.

Use a fresh private directory for the enrollment and payment test. It saves the virtual passkey, owner backup, recovery secret, and destination key before requesting faucet funds. The second test uses those saved files to prepare an exit for the resulting change with no passkey. Run that test separately to resume qualification without requesting more faucet funds.

```bash
HTTPS=true VAULT_E2E_PORT=3120 VAULT_E2E_OPERATOR_PORT=18900 VAULT_LIGHT_LIVE=mutinynet pnpm exec playwright test -c playwright.light-live.config.ts --project='Mobile Chrome'
```

The browser harness uses temporary runtime storage and stops after 20 minutes. Retain the private browser backup and prepared exit files after the harness ends. This harness does not qualify a production runtime restart or durable policy-sequence recovery.

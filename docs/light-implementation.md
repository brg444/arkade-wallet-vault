# Vaulted Light implementation

Status: contract and encrypted owner-key backup stage, September 5, 2026. Light is not available for enrollment or funding.

The candidate `vaulted-light-v1` profile uses `vault-light-policy-v1` Spending with per-payment and rolling 24-hour limits. Standard and Advanced retain their existing identities, descriptors, and signing paths.

## Implemented

`src/lib/vault/light/contract.ts` reconstructs the Light descriptor and commits its exact policy, network, public keys, exit delay, and output script. The cooperative leaf requires the owner, Vault cosigner, and stock Arkade Operator; the exit leaf requires the owner after the network-pinned delay. The runtime independently constructs matching scripts, control blocks, and descriptor digests from the same checked-in vectors.

`contractHandler.ts` round-trips the candidate through the SDK contract interface while excluding it from generic input selection. Its registration belongs to the future Light enrollment path.

`keyBackup.ts` encrypts the existing owner key using a 32-byte passkey PRF result or independently generated 32-byte recovery secret. Each envelope uses a fresh salt and nonce, HKDF-SHA256, AES-256-GCM, and authenticated descriptor metadata. Restoration verifies the resulting owner public key. Caller-owned secrets remain caller-owned; callers must wipe restored keys after use.

The encrypted key envelope is one component of recovery. It contains no VTXO transaction chain, passkey ceremony, or automatic restoration workflow. A recovery secret must come from a cryptographic random generator and be stored independently; a user password is outside this interface.

## Enrollment and funding dependencies

- Bind a scoped Light cosigner to the exact immutable policy and enrolled owner. The policy digest is an enrollment commitment; Bitcoin Script alone does not enforce the rolling allowance.
- Add the Light profile and enrollment-bound identity without making hardware optional in the existing profile. Preserve atomic allowance accounting, signed-operation reconciliation, and existing origin and authentication checks.
- Apply the global invitation mode to Light. Open enrollment obtains the same short-lived session; invite-only enrollment requires an invitation.
- Add passkey creation and restoration, authenticated backup import, separate recovery-secret handling, and complete VTXO recovery records. Verify recovery with the service unavailable and all passkeys lost as distinct cases.
- Qualify the explicit Light transaction adapter, persistent SDK lifecycle, renewal, expiry handling, and direct VTXO funding. Qualify a Light boarding program before enabling onchain receipt.
- Build the four-stage onboarding and optional watch-only Savings connection. Watched funds stay outside Spending balances, allowances, and signing flows.
- Run fresh test-network funding, payment, restart, lost-response, restoration, and exit drills before enabling Light on RC.

## Validation

The wallet contract vectors match the independent Go implementation for mainnet and Mutinynet. Tests reject cross-profile and network substitutions, altered policy commitments, duplicate signing roles, invalid keys, malformed SDK parameters, tampered ciphertext, modified authenticated metadata, and incorrect backup secrets.

The runtime executes the owner exit in Bitcoin's script engine and rejects insufficient delay, wrong timelock units, disabled relative locktime, an old transaction version, and the wrong owner key. These tests cover script execution; funded lifecycle and service-independent recovery remain release gates.

The current stage passes 878 wallet unit tests, type checking, focused lint, and the mainnet build. Runtime module verification, build, vet, full tests, and focused race checks pass. The current Contract Pack, deployment routes, and production enrollment tier list remain unchanged.

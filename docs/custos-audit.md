# Custos-style assessment — Arkade Vault (wallet-vault)

| Field | Value |
| --- | --- |
| Target | this repo (`VITE_VAULT_MODE`), manifest `custos-target.json` |
| Method | Custos harness run locally: operator intake + 5 bundles + lenses `value` `crypto` `protocol` `access` `psbt` `oracle` + `gates` + `verify`. No Venice key. Official CLI blocked on `VENICE_API_KEY`. |
| Date | 2026-08-17 |
| Scope | Client + deploy. Go authorizer is a separate tree; treated as a hostile API. |
| Threat model | Mutinynet faucet coins. Not mainnet. Not HSM. Same-origin XSS and Railway host compromise of VaultCosigner (not Savings) are accepted residuals. |
| Full write-up | `audit/report.md` |

This follows [ArkLabsHQ/custos](https://github.com/ArkLabsHQ/custos). The verifier rule applies: refute anything that only holds if we invent an on-chain invariant, and refute missing hardening with no shown input→harm.

## Intake (operator-owned)

See `custos-target.json` `intake[]`. Short form:

- **Crown jewels:** PRF, DirectP256 scalar, PhoneRoutine while unlocked, localStorage envelope, Operational UTXOs (capped), Savings (not spendable here).
- **Trusted:** this origin + WebAuthn UV+PRF. Everything else is hostile.
- **Out of scope:** mainnet, VTXO implementation, official-wallet seed stack, Go source except as API contract.
- **Blockers:** sign without local challenge match; no-change; fixture keys on Mutinynet; fake Success; sample QR.

## Context

First-party Mutinynet web client for an L1 Taproot 2FA operational vault, not an Ark VTXO wallet. Same-origin `/v1` is rewritten to a public Railway authorizer that holds VaultCosigner and the ledger. Routine spend is 3-of-3 with mandatory recursive change. Phone approval is WebAuthn + PRF-derived DirectP256; PhoneRoutine is AES-GCM under the PRF.

`inspectPSBT` binds prevout, change, packet, and sighash, and requires the input script to equal `status.operationalScript` / `status.operationalAddress`. It does **not** reconstruct Taproot `Q` from a locally hashed descriptor. Verify concluded that a surprise leaf cannot spend UTXOs already at the enrolled `Q`. The live hole is that the operational *address the user funds* is taken from the same hostile status.

## Bundles

| Bundle | Lenses | Status |
| --- | --- | --- |
| ceremony-psbt-and-spend | value, protocol, psbt, oracle | done (verify adjusted) |
| enroll-prf-and-storage | crypto, access | done |
| status-descriptor-identity | protocol, access | done — this is the surviving HIGH |
| client-money-path | value, protocol | done |
| deploy-and-boundary | access | done |

## Executive summary

| # | Severity | Lens | Verdict | Finding |
|---|----------|------|---------|---------|
| 1 | **HIGH** | protocol / oracle | confirmed | Deposit / savings address taken from unbound status |
| 2 | **HIGH** | access | confirmed | Public Railway authorizer holds VaultCosigner |
| 3 | **MEDIUM** | access | confirmed | Unbounded status + Esplora GET bodies |
| 4 | **LOW** | access | confirmed | Local authorizer launcher still G/2G + unsafe signer |

Leaf/`Q` reconstruct, thin enrollment parse, dual P-256, Reset, and ACAO `*` were **refuted** by verify. UI enrollment is currently broken (`ownerSecret` / `recoverySecret` required, not collected) — availability, not theft.

No new path that spends already-funded operational UTXOs without Face ID + PRF was confirmed.

## Confirmed findings

### 1. HIGH — status address is not pinned (`protocol`, `oracle`)

`vault.tsx` sets `operationalAddress = status?.operationalAddress || ''`. Receive and Home render that string. `requireStatusIdentity` only checks vault id + template/policy versions. `hashDescriptor` exists in `store.ts` and is never used as the Receive/send authority. Recovery binding matches authorizer binding to authorizer status, then `signInWithPasskey` refetches status.

Hostile `/v1/status` can swap the QR. New faucet deposits go to the attacker. Coins already at the real `Q` are not stolen; the UI just stops seeing them.

**Fix:** persist `hashDescriptor` (including scripts and addresses) with the envelope at enroll; require every later status and every `inspectPSBT` operational script to match.

### 2. HIGH — public Railway (`access`)

`vercel.json` rewrites `/v1` and `/health` to `authorizer-production-72de.up.railway.app`. That is the signing process. Client `?vault=` and public-status stripping do not move the key.

**Fix:** internal authorizer + gateway. Env-pin the hostname.

### 3. MEDIUM — unbounded GETs (`access`)

`fetchVaultStatus` / `fetchPublicStatus` use `res.json()`. `fetchAddressUtxos` / `fetchTxHex` / `fetchAddressStats` use `res.json()` / `res.text()`. `api.ts` already has a 1 MiB `readBounded` that these paths skip. Hostile body → tab OOM.

### 4. LOW — demo launcher (`access`)

`scripts/start-vault-authorizer.sh`: `-unsafe-local-signer`, default pubs `2G` / `G`, regtest on localhost.

## Refuted / do not re-file

- **Surprise leaf steals funded UTXOs** — `inspectPSBT` binds `witnessUtxo` to prevout and to the operational script. A non-member leaf is consensus-invalid on that UTXO. Missing `Q` reconstruct is hardening, not this theft.
- Fake Success, sample QR, grey-area enrolled, mainnet regex, mempool balance, review without change, demo keys on Mutinynet, missing CSP, register-before-persist, public status naming a vault.
- Thin `parseEnrollment` as extra theft beyond accepted XSS.
- Dual P-256 as a shown exploit (same HKDF info today).
- Reset as an attacker path (user-initiated, local only).
- ACAO `*` on HTML (CSP is same-origin).

## Remediations

1. **Deposit pin.** `fetchVaultStatus` never creates a pin. It only checks an existing one. A pin is written after verified enroll finish or after recovery-binding signatures verify. The funded kiosk (`operational-vault-v1`) is seeded from a compiled-in address/script (`src/lib/vault/kiosk.ts`), not from first-seen status. First-use TOFU is **not** accepted for this demo.
2. **Railway hostname.** `vercel.json` rewrites `/v1` and `/health` to `/api/authorizer/*` only. The function reads `AUTHORIZER_ORIGIN` and `AUTHORIZER_GATEWAY_SECRET` from server env. Production `authorizerBase()` is empty (same-origin). `VITE_VAULT_API` is ignored in production builds. Direct Railway ingress is **not** disabled from this repo — that is an operator step after the authorizer accepts `X-Vault-Gateway-Secret`.
3. **GET cap.** `readBounded` (1 MiB) is shared and counts **UTF-8 bytes** on the non-streaming fallback as well as streamed chunks.
4. **Local launcher.** Fixture G/2G pubs are refused in **either** owner or recovery role off regtest. `-unsafe-local-signer` remains regtest-only.

`enroll()` still does not pass `ownerSecret` / `recoverySecret`. That is the tenant ceremony, not this client.

Do not migrate the live funded vault. Sweep it if needed and enroll new tenants; they pin after ceremony.

## Next

1. Set Vercel `AUTHORIZER_ORIGIN` + `AUTHORIZER_GATEWAY_SECRET` (server env). Set the same secret on the authorizer. Disable or IP-restrict Railway public ingress so only the gateway can reach `/v1`.
2. Export `VENICE_API_KEY` (or Prem/OpenAI/Custos) and re-run the machine CLI with `--verify` if you want a second opinion from the official engine.
3. Add a **second** Custos target for the Go authorizer / tenant tree. Do not merge manifests.
4. Do not implement VTXO from this report.
5. Tenant/PR2 still owns enroll proofs; this client `enroll()` does not pass them.
6. Do not deploy until the security commit is reviewed and Railway ingress is restricted.

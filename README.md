# Vault client

This branch is the **Mutinynet L1 Taproot vault client**. It is not the
Arkade VTXO wallet.

The **signer** is a separate process (`cmd/authorizer`). This repo is the
hostile proposer: a PWA that enrolls a passkey, holds a PRF-wrapped software
key, and asks the authorizer to cosign.

Live demo: [https://arkade-vault-demo.vercel.app](https://arkade-vault-demo.vercel.app)

Mutinynet coins only. Not production custody. Not an HSM. Do not send real
bitcoin.

**Now / next:** [docs/plan.md](docs/plan.md)  
**Live v4 contract:** [docs/live.md](docs/live.md)  
**Next product (v5):** [docs/v5-overview.md](docs/v5-overview.md)

## What is live today

The public authorizer still enrolls and spends **v4**:

- Daily: routine 3-of-3 under a 50k / 100k sat cap
- Savings: this device + hardware
- CSV 144 = this device (lost hardware); CSV 6 = hardware (lost device)
- No RecoveryKey

Hardware can move first on mature Savings. That is why v5 is the next
product: staging so a theft clock starts *now*, not at the coin’s age.

## Packaging

Deployable signer surface: `/Users/alexb./code/arkade-vault-server`
([contract-pack.json](src/lib/vault/contract-pack.json)). Go still builds
from the emulator checkout until v5 mint is extracted.

```text
vault client (this repo, Vercel)
    same-origin /v1
        → vault server (authorizer-next, Railway)
              VaultCosigner + SQLite
              outbound HTTPS → pinned Arkade cosigner
```

Two deployables. One frozen contract pack (template, policy, domains).
Production does not compile an authorizer URL into the bundle. Vercel adds
`X-Vault-Gateway-Secret`. `/v1/register` is 404. Enrollment is invite-gated.

| Server env | Role |
| --- | --- |
| `AUTHORIZER_ORIGIN` | Railway authorizer-next |
| `AUTHORIZER_GATEWAY_SECRET` | Shared with the authorizer |

Do not make trees or caps operator-configurable. New rules are a new
**named** template, fail-closed against the old one.

## Run

Bun.

```bash
bun install
bun run start:vault
```

[http://localhost:3003](http://localhost:3003). Dev-only: `VITE_VAULT_API`.
Production ignores it.

```bash
bun run test
bun run lint
bun run build:vault
```

`bun run start` / `bun run build` still build the upstream VTXO wallet.
Vercel deploys `build:vault` only.

## Trust

- Browser-memory software key, not Secure Enclave
- Railway + Vercel isolation, not VLS / anti-rollback
- Same-origin XSS can steal an unlocked PhoneRoutine or PRF
- The public Arkade cosigner is availability and privacy
- Caps are signer policy, not Bitcoin consensus

## Upstream

Forked from [arkade-os/wallet](https://github.com/arkade-os/wallet).

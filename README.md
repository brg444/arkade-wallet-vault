# Arkade Vault

A vault on this phone. Daily spend with Face ID. Savings that need
hardware too. Testnet only. Don’t send real bitcoin.

Live demo: [https://arkade-vault-demo.vercel.app](https://arkade-vault-demo.vercel.app)

How we talk about it: [docs/voice.md](docs/voice.md)  
Where the spec lives: [docs/architecture.md](docs/architecture.md)  
What’s live vs next: [docs/plan.md](docs/plan.md) · [docs/live.md](docs/live.md)

This is not the Arkade VTXO wallet. The vault **service** is a separate
signer. This repo is the phone app.

## What people use today

- **Spending** — this phone, up to a daily limit
- **Savings** — this phone and hardware together
- **Vault service** — helps daily spend, cannot take Savings
- **Recovery** — optional. Skip and the vault is this device plus hardware.
  Add a recovery key and it can start a waiting period you can cancel.

Engineers: new enrolls are v5 only. Leftover v4 UTXOs still spend until
swept. See [docs/live.md](docs/live.md).

## Packaging

Deployable signer packaging: [arkade-vault-server](https://github.com/brg444/arkade-vault-server)
([contract-pack.json](src/lib/vault/contract-pack.json)). Go still builds
from [arkade-2fa-vault-poc](https://github.com/brg444/arkade-2fa-vault-poc)
(`cmd/authorizer`) until that tree is extracted.

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

| Server env                  | Role                       |
| --------------------------- | -------------------------- |
| `AUTHORIZER_ORIGIN`         | Railway authorizer-next    |
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

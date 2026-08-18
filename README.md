# Arkade Vault

Mutinynet vault client. Daily spend on this phone. Savings need hardware
too. Testnet only. Don’t send real bitcoin.

Live demo: [https://arkade-vault-demo.vercel.app](https://arkade-vault-demo.vercel.app)

This repo is the PWA. The signer source and image is
[arkade-vault-server](https://github.com/brg444/arkade-vault-server)
(`cmd/authorizer`). This is not the Arkade VTXO wallet.

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

## Deploy

```text
vault client (this repo, Vercel)
    same-origin /v1
        → vault server (Railway)
```

Production does not compile an authorizer URL into the bundle. Vercel
adds `X-Vault-Gateway-Secret`. Enrollment is invite-gated.

| Server env                  | Role                    |
| --------------------------- | ----------------------- |
| `AUTHORIZER_ORIGIN`         | Railway vault server    |
| `AUTHORIZER_GATEWAY_SECRET` | Shared with the server  |

See the server repo for Compose and Railway.

## Upstream

Forked from [arkade-os/wallet](https://github.com/arkade-os/wallet).
VTXO swap harness: [docs/swaps.regtest.md](docs/swaps.regtest.md).

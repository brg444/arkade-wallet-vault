# Arkade Vault

Spend from this phone with Face ID. Savings need hardware too. Recovery
is optional — skip it if you want.

**Demo:** [arkade-vault-demo.vercel.app](https://arkade-vault-demo.vercel.app)

Testnet only (Mutinynet). Don’t send real bitcoin.

This repo is the phone app. The vault service is a separate program
([arkade-vault-server](https://github.com/brg444/arkade-vault-server)).
This is not the Arkade VTXO wallet.

## What you get

- **Spending** — this phone, up to a daily limit
- **Savings** — this phone and a hardware key together
- **Vault service** — helps daily spend, cannot take Savings
- **Recovery** — optional. Skip it and the vault is this phone plus
  hardware. Add it and someone can start a waiting period you can cancel.
  Recovery cannot spend your everyday coins by itself.

If someone starts recovery who shouldn’t have, you cancel it. After the
wait, you move the coins. There is no shortcut where stolen hardware
sweeps mature Savings after a few blocks.

## Where the code lives

| Repo | What it is |
| --- | --- |
| **This one** | The phone app |
| [arkade-vault-server](https://github.com/brg444/arkade-vault-server) | The vault service (signs daily spend, keeps the books) |
| [arkade-2fa-vault-poc](https://github.com/brg444/arkade-2fa-vault-poc) | Script engine only. Not the app, not the service |

```text
phone app  →  /v1 on the same site  →  vault service
```

You need an invite to enroll. More detail: [docs/](docs/README.md).

## Run it

Bun.

```bash
bun install
bun run start:vault
```

[http://localhost:3003](http://localhost:3003)

```bash
bun run test
bun run lint
bun run build:vault
```

Vercel ships `build:vault` only. The old `bun run start` still builds
the upstream VTXO wallet.

## Be honest about trust

- The key on this phone lives in the browser, not in the Secure Enclave
- The service runs on Railway, not in an HSM
- If this site is XSS’d while you’re unlocked, that phone key can be stolen
- Limits are the service’s rules, not Bitcoin’s
- Don’t put real money here

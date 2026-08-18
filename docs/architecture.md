# Where the spec lives

One owner per layer. Do not copy this table into the emulator README.

| Layer | File | Owns |
| --- | --- | --- |
| Product language | [voice.md](voice.md) | Names: this device, hardware, vault service, optional recovery |
| What is funded | [live.md](live.md) | Live Mutinynet: v5 enroll, leftover v4 coins |
| Now / next / later | [plan.md](plan.md) | Packaging split, leftover v4, extract |
| v5 program | [v5-overview.md](v5-overview.md), [v5-transactions.md](v5-transactions.md), [v5-api.md](v5-api.md) | Trees, txs, HTTP, kit |
| Client entry | [../README.md](../README.md) | This PWA, same-origin `/v1`, contract pack |
| Named programs | [../src/lib/vault/contract-pack.json](../src/lib/vault/contract-pack.json) | Frozen strings. Not env knobs |
| Signer operate | authorizer `poc/2fa-vault/README.md` | HTTP, enroll, claims |
| Packaging | [arkade-vault-server](https://github.com/brg444/arkade-vault-server) README | Compose, image, volume |

This repo is the protocol and the phone. The Go signer still lives in
[arkade-2fa-vault-poc](https://github.com/brg444/arkade-2fa-vault-poc)
(`cmd/authorizer`) until it is extracted. That tree is source, not the
architecture home.

## After the extract

Three public files:

1. This wallet `README` + `docs/` — what Bitcoin and the phone do
2. `arkade-vault-server` README — how to run the validating cosigner
3. `contract-pack.json` — which named program is live, leftover, or optional

Until then, do not rewrite the emulator monorepo as the system design.

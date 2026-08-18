# Arkade Vault

A vault on this phone. Daily spend with Face ID. Savings that need
hardware too. Recovery is optional.

**Live demo:** [arkade-vault-demo.vercel.app](https://arkade-vault-demo.vercel.app)

> Mutinynet only. Not a custody product. Not an HSM. Do not send real
> bitcoin. Leftover v4 coins, if any, are recovered out of band.

This repository is the **phone app** (PWA). It is a fork of
[arkade-os/wallet](https://github.com/arkade-os/wallet) used only as a
shell. The vault **service** is a separate signer. This is not the Arkade
VTXO wallet.

## About the product

Think checking and savings, not an exchange account.

| People say | What it is |
| --- | --- |
| This device | PhoneRoutine (browser software) + Face ID / passkey |
| Hardware | Independent pubkey. Needed for Savings and admin |
| Vault service | Validating cosigner. Helps daily spend. Cannot take Savings |
| Recovery | Optional third guardian. Starts a waiting period you can cancel |

Skip recovery and the vault is this device plus hardware. Add a recovery
key and it can start a new clock; it cannot spend Normal coins alone.

## Repositories

Same pattern as Revault: one architecture, one repo per process.

| Repo | Owns |
| --- | --- |
| **This one** | Phone UI, client trees, contract-pack pin, Vercel gateway |
| [arkade-vault-server](https://github.com/brg444/arkade-vault-server) | Signer, ledger, enroll, authorize, image |
| [arkade-2fa-vault-poc](https://github.com/brg444/arkade-2fa-vault-poc) | Emulator script engine (`pkg/arkade`). Not the signer |

```text
browser  (this repo, Vercel)
    same-origin /v1
        → vault-authorizer  (arkade-vault-server, Railway)
              VaultCosigner + SQLite
              outbound HTTPS → pinned public Arkade cosigner
```

The page never embeds the authorizer URL. Vercel adds
`X-Vault-Gateway-Secret`. Enrollment is invite-gated.
`POST /v1/register` is not on Mutinynet.

## How the vault is constructed

Live enroll is `phone-hww-recovery-staged-v5` / `arkade-vault/v5`.
Trees and delays: [docs/program.md](docs/program.md).

Daily spend is Face ID + a 3-of-3 routine leaf (this device + two
tweaked cosigners) under a cap. Savings is this device and hardware
together. There is no singlesig CSV on a Normal coin. A claimant must
first create a **new** Pending output whose clock starts now.

## Documentation

| Read | What it is |
| --- | --- |
| [docs/README.md](docs/README.md) | Index |
| [docs/architecture.md](docs/architecture.md) | One owner per layer |
| [docs/program.md](docs/program.md) | Trees, clocks, named program |
| [docs/security.md](docs/security.md) | What is closed, what is not |
| [SECURITY.md](SECURITY.md) | How to report a hole |

## This repository

| Path | Description |
| --- | --- |
| `src/screens/Vault/` | What people tap |
| `src/lib/vault/` | Client tx brain |
| `src/lib/vault/v5/` | Live enroll program |
| `src/lib/vault/contract-pack.json` | Frozen strings. Keep byte-identical to the server copy |
| `api/` | Same-origin `/v1` gateway |

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

## Trust, in one screen

- PhoneRoutine is browser-memory software, not Secure Enclave
- Railway + Vercel isolation, not VLS / anti-rollback
- Same-origin XSS can steal an unlocked PhoneRoutine or PRF
- The public Arkade cosigner is availability and privacy
- Caps are signer policy, not Bitcoin consensus
- The process master scalar is IKM. It is never a Taproot signer

# Architecture

Arkade Vault is three public repos and two processes. The protocol lives
here. The signer lives in vault-server. The emulator tree is a
dependency, not the product.

```text
                    this phone
                 (arkade-wallet-vault)
                         |
                    same-origin /v1
                         |
              Vercel gateway (+ secret)
                         |
                 vault-authorizer
              (arkade-vault-server)
                    /          \
           SQLite ledger    VaultCosigner (file)
                    \
                     pinned HTTPS
                  public Arkade cosigner
                 (pkg/arkade script engine)
```

## Who owns what

| Layer | Lives in | Owns |
| --- | --- | --- |
| Product language | root README | Names: this device, hardware, vault service, optional recovery |
| Trees and txs | [program.md](program.md), `src/lib/vault/v5/` | Client rebuild of the family |
| Named program strings | `contract-pack.json` (both client and server, byte-identical) | Template, policy, domains |
| HTTP parse | vault-server `internal/iface/http` | Routes, origin, JSON |
| Authorize / enroll | vault-server `internal/application` | Policy, reservation, descriptor rebuild |
| Process bootstrap | vault-server `internal/authorizer` | IKM, ledger open, public emulator pin |
| Script opcodes | `pkg/arkade` in the emulator repo | Engine only |
| Image / Compose | vault-server Dockerfiles | How to run the signer |

A stranger should reconstruct the protocol from that table. New rules
are a new named template, not an env knob.

## What each process is allowed to do

| Process | Can | Cannot |
| --- | --- | --- |
| Phone | Propose spend, hold PhoneRoutine, Face ID | Invent the Daily `Q` |
| vault-authorizer | Cosign routine / initiate / clawback after rebuild | Spend Savings, sign claim |
| Public Arkade cosigner | Second routine / transition signature | See WebAuthn, change dest |

Claim after Pending matures is serverless. The authorizer must not be
required.

## Network

Live is Mutinynet. Invite multi-tenant. No mainnet. No
`/v1/register` on the authorizer.

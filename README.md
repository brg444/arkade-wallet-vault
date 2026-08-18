# Spending vault

This branch is a **Mutinynet L1 Taproot vault client**, not the Arkade VTXO
wallet. It enrolls a passkey, pins a hardware key, and spends ordinary
`tb1p…` UTXOs against a public authorizer.

Live demo: [https://arkade-vault-demo.vercel.app](https://arkade-vault-demo.vercel.app)

It is a demonstration. Mutinynet coins only. Not production custody, not an
HSM, not an Ark VTXO wallet. Do not send real bitcoin.

## What you get

Two accounts on the same enrolled vault:

| Account | How you spend now | If you lose something |
| --- | --- | --- |
| Daily | This device, under a 50k sat send cap and 100k sat daily allowance | Device-only CSV after **144** blocks (~72 min on Mutinynet) |
| Savings | This device + hardware | Hardware-only CSV after **6** blocks (~3 min); device-only after 144 |

Hardware can always move first. A stolen phone with the passkey cannot beat
hardware to Savings.

There is no RecoveryKey. Admin is device + hardware. The retired v3
`RecoveryKey` leaf is not in this product.

## On-chain tree

Template `phone-direct-p256-routine-3of3-admin-phone-hww-v4`. Policy
`mandatory-change-tx50k-day100k-fee5k-feerate10-onchain-v3`.

Daily (Operational) has four paths:

1. Routine 3-of-3: `PhoneRoutineBIP340` + tweaked VaultCosigner + tweaked
   ArkadeCosigner
2. Admin 2-of-2: this device + hardware
3. CSV + this device (144)
4. CSV + hardware (6)

Savings has admin plus the same two CSV leaves. No routine path. No
cosigner can spend Savings.

The passkey does not sign Bitcoin. WebAuthn proves origin / RP / UV off
chain. A separate PRF-derived P-256 key signs the Arkade sighash. The
browser keeps a random secp256k1 software key (`PhoneRoutineBIP340`)
encrypted under the PRF.

## How the pieces talk

```text
browser  →  Vercel (same-origin /v1)  →  Railway authorizer-next
                                              ├─ file-backed VaultCosigner
                                              ├─ SQLite ledger
                                              └─ outbound HTTPS to pinned Arkade cosigner
```

Production never compiles an authorizer URL into the bundle. The page calls
`/v1` on its own origin. Vercel adds `X-Vault-Gateway-Secret` and proxies
only allowlisted paths. `/v1/register` is not one of them (404). Enrollment
is invite-gated `/v1/enroll/start` → `/propose` → `/finish`.

Server env on Vercel:

| Name | Role |
| --- | --- |
| `AUTHORIZER_ORIGIN` | Railway authorizer-next origin |
| `AUTHORIZER_GATEWAY_SECRET` | Shared with the authorizer |

## Run it

This workspace uses [Bun](https://bun.sh).

```bash
bun install
bun run start:vault
```

Open [http://localhost:3003](http://localhost:3003). Point the page at a
local or Mutinynet authorizer with `VITE_VAULT_API` (dev only). Production
ignores that variable.

```bash
bun run test
bun run lint
bun run build:vault
```

`bun run start` / `bun run build` still build the upstream VTXO wallet.
That path is not what Vercel deploys.

## What this client will refuse

- Generator G or 2G as the hardware key on Mutinynet
- A status or descriptor that still carries `recoveryKeyPub`
- A leftover v3 template
- First-seen TOFU of a deposit address (pin after enroll finish only)
- Cross-origin `connect` in production (CSP is same-origin)

The compiled kiosk addresses in `src/lib/vault/kiosk.ts` are the retired
empty v3 singleton. They are not seeded into Receive.

## Honest limits

- Browser-memory software key, not Secure Enclave or attestation
- Railway + Vercel isolation, not an enclave
- SQLite has no anti-rollback store
- The public Arkade cosigner is an availability and privacy dependency
- Preflight/bind traffic is not private
- Caps are authorizer policy, not a Bitcoin consensus rule

The authorizer lives in a separate tree (`poc/2fa-vault`). Schema 6, if it
ever drops the leftover `recovery_key_compressed` column, is a separate RFC.

## Upstream

Forked from [arkade-os/wallet](https://github.com/arkade-os/wallet). The
VTXO app, Boltz, Nostr backup, and `ghcr.io/arkade-os/wallet` image are
that project. This branch is the vault-mode client only.

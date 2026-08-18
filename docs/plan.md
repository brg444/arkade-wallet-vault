# Now, next, later

Arkade Vault is a vault on this phone: daily spend with Face ID,
Savings that need hardware, a vault service that cannot take Savings.
How we say that: [voice.md](voice.md).

The next **program** (v5) is not live on the signer yet. Recovery is
optional in the app. Do not enroll it against today’s signer.

The long mapping: Arkade as a validating cosigner (Safe-like _account_,
VLS-like _isolation_, Bitcoin Script _exits_). This vault is the first
named program on that signer, not the whole platform.

## Now — keep v4 honest

Live Mutinynet is v4. Do not pretend otherwise.

| Item         | Do                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Contract     | Keep `phone-direct-p256-routine-3of3-admin-phone-hww-v4` + `…onchain-v3` + CSV 144/6 frozen     |
| Client       | This PWA. Leftover v4 UTXOs still spend. Do not mint new v4 once v5 enroll is on the authorizer |
| Server       | Railway `authorizer-next`. Invite `/v1/enroll/*`. No `/v1/register`                             |
| Leftover v3  | Exact-template quarantine only. Anything else fails closed                                      |
| Packaging    | Two processes, two hosts. Document the split. **Do not extract repos yet**                      |
| Policy knobs | None. Caps and trees are the named program                                                      |
| VTXO         | Out. Do not merge Ark balances into Home                                                        |

Client code under `src/lib/vault/v5/` is the next-product prototype. The
live authorizer still rebuilds v4 descriptors. A v5-only client will fail
enroll against today’s server until Next lands.

## Next — v5 is the product

Named program: `phone-hww-recovery-staged-v5` / schema `arkade-vault/v5`.

The authorizer is already implementing this (same `poc/2fa-vault` tree):
schema 6 `recovery_session`, `DecideReplay` (refuse a second dest), and
Go execution tests against client initiate/clawback goldens. It does **not**
yet rebuild or enroll the v5 family — `TemplateVersion` is still v4.

| Item          | Do                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Why           | Today, hardware can move mature Savings after a short wait on _that_ coin. Next program: a _new_ waiting period you can cancel |
| Keys          | This device + hardware. Recovery is **optional**. It starts a waiting period; it does not spend the original coin alone        |
| Graph         | Normal → initiate → Pending → clawback to Quarantine **or** claim after CSV                                                    |
| Cosigners     | Required on initiate and clawback. **Not** required on mature claim                                                            |
| SQLite        | Schema 6: `recovery_session` sign-once oracle. Leftover `recovery_key_compressed` decision is in that RFC                      |
| Packaging     | Extract **vault-server** (authorizer image + runbook). Keep **vault-client** as this app (later a thin PWA)                    |
| Contract pack | One published set of strings both sides pin. New program = new id + golden vectors + leftover class for v4                     |
| Watcher       | Persistent alert on every Normal→Pending. Browser watch is not enough for a 6-block race. No auto-clawback                     |
| Recovery Kit  | Public family + inspect / initiate / clawback / claim. No PhoneRoutine, no hardware WIF                                        |

Do not:

- put singlesig CSV back on Normal
- skip recovery and fall back to v4
- require the authorizer on mature claim
- extract `route/` as a second framework (the table already lives in `v5/route.ts`)
- board VTXOs in the same PR

## Later — platform, not this vault’s job

After v5 is the live enroll and the server is its own image:

- Treat the authorizer as a **validating cosigner** that runs a small
  registry of named programs (v4 leftover, v5 staged, then others)
- Steal VLS isolation, anti-rollback, and a chain oracle — today’s
  Railway/env key is not that
- Miniscript / BIP-388 on Bitcoin-enforced exits
- Optional `board` onto a policy VTXO **after** a spike that does not
  merge L1 and Ark money
- Never operator-defined trees or caps as deploy flags

## Split packaging (concrete)

```text
now     packaging started in /Users/alexb./code/arkade-vault-server
        compose + Dockerfiles + contract-pack.json
        Go still builds from EMULATOR_ROOT (v5 mint lives there)
        vault-client still this wallet fork

next    authorizer enrolls v5; then lift cmd/authorizer into vault-server
        thin PWA over src/lib/vault
        both sides import the same contract-pack.json

later   signer image runs program ids; client is any hostile proposer
```

“Anyone can deploy” means: their signer + a **listed** program + Bitcoin
exits. It does not mean a policy workshop.

## Reviewability (Revault shape, not Revault maturity)

A stranger should reconstruct the protocol from a small set of files, with
one owner per layer. Docs now match that _shape_:

| Read this                                   | Owner                     |
| ------------------------------------------- | ------------------------- |
| [README.md](README.md) → [live.md](live.md) | What is funded today (v4) |
| [v5-overview.md](v5-overview.md)            | Next product              |
| [v5-transactions.md](v5-transactions.md)    | Trees and txs             |
| [v5-api.md](v5-api.md)                      | HTTP / kit CLI            |
| `src/lib/vault/v5/`                         | Client tx brain           |
| Authorizer `cmd/authorizer`                 | Signer (still v4 mint)    |

That is not operational maturity. There is no one-command unvault/cancel
race, no always-on watcher, no shared Go/TS goldens, no extracted daemon.
The next quality jump is **not more prose**. It is the authorizer
implementing the spec the docs already claim: rebuild v5 trees, persist
schema 6 sessions, refuse a second dest.

## Order of work

1. Authorizer rebuilds v5 descriptors and refuses v4 propose for new invites
2. Schema 6 + `recovery_session` + rehearsal from a schema-5 snapshot
3. Initiate / clawback / claim on the authorizer (claim unsigned)
4. Shared Go/TS golden vectors for the v5 family
5. Recovery Kit + persistent watcher (alert only)
6. Cut over live enroll; leftover v4 UTXOs spend until swept
7. Extract vault-server image from the emulator monorepo

# Now, next, later

Arkade Vault is a vault on this phone: daily spend with Face ID,
Savings that need hardware, a vault service that cannot take Savings.
How we say that: [voice.md](voice.md).

The next **program** (v5) is optional recovery. Skip recovery and enroll
stays v4. Supply a recovery key and the signer mints v5.

The long mapping: Arkade as a validating cosigner (Safe-like _account_,
VLS-like _isolation_, Bitcoin Script _exits_). This vault is the first
named program on that signer, not the whole platform.

## Now — keep v4 honest

Live Mutinynet is v4. Do not pretend otherwise.

| Item         | Do                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Contract     | Keep `phone-direct-p256-routine-3of3-admin-phone-hww-v4` + `…onchain-v3` + CSV 144/6 frozen     |
| Client       | This PWA. Skip recovery mints v4. A tenant who chose v5 keeps leftover v4 UTXOs spendable |
| Server       | Railway `authorizer-next`. Invite `/v1/enroll/*`. No `/v1/register`                             |
| Leftover v3  | Exact-template quarantine only. Anything else fails closed                                      |
| Packaging    | Two processes, two hosts. Document the split. **Do not extract repos yet**                      |
| Policy knobs | None. Caps and trees are the named program                                                      |
| VTXO         | Out. Do not merge Ark balances into Home                                                        |

Client code under `src/lib/vault/v5/` is the optional-recovery program.
The live authorizer rebuilds v4 when recovery is skipped and v5 when a
recovery key is supplied. Do not treat skip-recovery as an error.

## Next — v5 is the product

Named program: `phone-hww-recovery-staged-v5` / schema `arkade-vault/v5`.

The authorizer already rebuilds this family when recovery is supplied:
schema 6 `recovery_session`, `DecideReplay` (refuse a second dest), and
Go/TS goldens for the 14-tree addresses. Skip recovery and `TemplateVersion`
stays v4.

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
- treat skip-recovery as an error; v4 is the default when recovery is omitted
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
| [architecture.md](architecture.md)          | One map, one owner per layer |
| [README.md](README.md) → [live.md](live.md) | What is funded today         |
| [v5-overview.md](v5-overview.md)            | Optional recovery program    |
| [v5-transactions.md](v5-transactions.md)    | Trees and txs                |
| [v5-api.md](v5-api.md)                      | HTTP / kit CLI               |
| `src/lib/vault/v5/`                         | Client tx brain              |
| Authorizer `cmd/authorizer`                 | Signer (v4 default, v5 if recovery) |

That is not operational maturity. There is no one-command unvault/cancel
race, no always-on watcher, no extracted daemon. The next quality jump is
the extract and leftover v4 spend until swept.

## Order of work

1. Leftover v4 UTXOs spend until swept. Do not mint new v4 after a tenant chooses v5.
2. Recovery Kit + persistent watcher (alert only)
3. Extract vault-server image from the emulator monorepo
4. Thin PWA over `src/lib/vault`

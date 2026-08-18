# Now, next, later

Arkade Vault is a vault on this phone: daily spend with Face ID,
Savings that need hardware, a vault service that cannot take Savings.
How we say that: [voice.md](voice.md).

The only enrollable program is v5. Recovery is optional: skip it and the
family is this device plus hardware. Add a recovery key and it is a third
guardian. Leftover v4 coins still load if a row exists; recover those
funds out of band. Do not mint v4.

The long mapping: Arkade as a validating cosigner (Safe-like _account_,
VLS-like _isolation_, Bitcoin Script _exits_). This vault is the first
named program on that signer, not the whole platform.

## Now — v5 is the only enroll

| Item         | Do                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------- |
| Contract     | Live `phone-hww-recovery-staged-v5` / `arkade-vault/v5`. Recovery optional                  |
| Client       | This PWA. Skip recovery still enrolls v5 (two guardians). Add recovery → third guardian     |
| Server       | Railway `authorizer-next`. Invite `/v1/enroll/*`. Propose and finish always mint v5         |
| Leftover v4  | Existing rows still load. Exact leftover v3 template stays quarantined. No new v4           |
| Packaging    | Two processes, two hosts. Document the split. **Do not extract repos yet**                  |
| Policy knobs | None. Caps and trees are the named program                                                  |
| VTXO         | Out. Do not merge Ark balances into Home                                                    |

Client code under `src/lib/vault/v5/` is the live enroll program.
Skip recovery is a two-guardian v5 vault. It is not an error and it is
not v4.

## Next — extract and watch

Named program stays `phone-hww-recovery-staged-v5`. Schema 6 already has
`recovery_session` and `DecideReplay` (refuse a second dest).

| Item          | Do                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------- |
| Why           | Hardware must not move mature Savings after a short wait on _that_ coin                     |
| Keys          | This device + hardware. Recovery is **optional**. It starts a waiting period                |
| Graph         | Normal → initiate → Pending → clawback to Quarantine **or** claim after CSV                 |
| Cosigners     | Required on initiate and clawback. **Not** required on mature claim                         |
| Packaging     | Extract **vault-server** (authorizer image + runbook). Keep **vault-client** as this app    |
| Contract pack | One published set of strings both sides pin. New program = new id + goldens                 |
| Watcher       | Persistent alert on every Normal→Pending. No auto-clawback                                  |
| Recovery Kit  | Public family + inspect / initiate / clawback / claim. No PhoneRoutine, no hardware WIF     |

Do not:

- put singlesig CSV back on Normal
- treat skip-recovery as an error or as a v4 mint
- require the authorizer on mature claim
- extract `route/` as a second framework (the table already lives in `v5/route.ts`)
- board VTXOs in the same PR

## Later — platform, not this vault’s job

After the server is its own image:

- Treat the authorizer as a **validating cosigner** that runs a small
  registry of named programs
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

next    lift cmd/authorizer into vault-server
        thin PWA over src/lib/vault
        both sides import the same contract-pack.json

later   signer image runs program ids; client is any hostile proposer
```

“Anyone can deploy” means: their signer + a **listed** program + Bitcoin
exits. It does not mean a policy workshop.

## Reviewability (Revault shape, not Revault maturity)

A stranger should reconstruct the protocol from a small set of files, with
one owner per layer. Docs now match that _shape_:

| Read this                                   | Owner                        |
| ------------------------------------------- | ---------------------------- |
| [architecture.md](architecture.md)          | One map, one owner per layer |
| [README.md](README.md) → [live.md](live.md) | What is funded today         |
| [v5-overview.md](v5-overview.md)            | Live enroll program          |
| [v5-transactions.md](v5-transactions.md)    | Trees and txs                |
| [v5-api.md](v5-api.md)                      | HTTP / kit CLI               |
| `src/lib/vault/v5/`                         | Client tx brain              |
| Authorizer `cmd/authorizer`                 | Signer (v5 enroll only)      |

That is not operational maturity. There is no one-command unvault/cancel
race, no always-on watcher, no extracted daemon.

## Order of work

1. Keep leftover v4 rows loadable. Do not mint v4. Recover those coins out of band.
2. Recovery Kit + persistent watcher (alert only)
3. Extract vault-server image from the emulator monorepo
4. Thin PWA over `src/lib/vault`

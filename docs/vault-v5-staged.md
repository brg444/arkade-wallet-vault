# Handoff: Arkade Vault v5 staged recovery

Read this before changing vault trees, enroll, or recovery. This is the approved plan plus what is already on disk. A new session will not have the old chat.

**Repo:** `/Users/alexb./code/arkade-wallet-vault`  
**Branch:** `vault-mode`  
**Live demo:** https://arkade-vault-demo.vercel.app (`--scope alex-b-s-projects1`)  
**Authorizer:** separate Go service (Railway `authorizer-next`). Do not invent endpoints. Rebuild descriptors from canonical inputs; never trust client scripts.

## What is already shipped (v4 product)

Live Mutinynet wallet: Daily routine 3-of-3, Savings admin is phone + hardware, CSV 6 = hardware-only, CSV 144 = phone-only. That hardware-after-6 path is an **attacker hatch** on mature coins (clock is UTXO age, not “time since theft”).

Also in this branch: tenant enroll, Face ID, pull-to-update PWA, Savings PSBT share sheet, no RecoveryKey on v4.

Latest v5 start: commit `5e320ce` — `src/lib/vault/v5/` (context NUMS, Quarantine, Pending, P2A constants, tests).

## Do not reopen

- Do not mint new v4 enrolls once v5 ships. Do not reinterpret funded v4 UTXOs.
- Do not add `phone + recovery` immediately on Normal (that bypasses hardware on Savings).
- Do not put singlesig CSV on Normal. Staging only.
- Do not use `SHA256(x-only ‖ blob ‖ index)` for on-chain backup (x-onlys are public).
- Do not require the authorizer to sign mature claims.
- Do not paste hardware WIF on the daily phone.
- Do not implement VTXO or Anzen yearly presign in this work.
- Mutinynet only. 6 / 144 / 288 are demo clocks.

## Locked protocol (v5)

New enrolls: phone + hardware + **required** recovery. Staged exits.

```
Normal --initiate (claimant + 2 cosigners, dest pinned)--> Pending
Pending --before deadline: guardian + 2 cosigners--> Quarantine(excludes suspect)
Pending --after new CSV: claimant only--> claim (any dest; say so)
```

CSV on Pending starts when **that** output confirms.

| Suspected claimant | Quarantine 2-of-2 |
|---|---|
| Phone | hardware + recovery |
| Hardware | phone + recovery |
| Recovery | phone + hardware |

Daily and Savings each have 3 Pending + 3 Quarantine. **Internal key is not raw NUMS.** It is NUMS TapTweaked with

`tagged_hash("arkade-vault/v5/internal", vaultId || kind || claimant || template)`

Implemented as `taprootTweakPubkey(NUMS, context)` in `src/lib/vault/v5/context.ts` (always a valid x-only; safer than lift_x). Same Go/TS vectors required.

**Fees (frozen):** RBF + exact P2A on every initiate/clawback. Script `51024e73`, value `0`, output index `1`. Sequence must signal RBF (`0xffffffff` forbidden on those txs). Claims may omit P2A; claimant RBFs their own tx.

**Cosigners:** required for initiate and clawback (Savings too). **Not** required after Pending matures.

**PoP:** BIP340 over vault id, invite, recovery x-only, full descriptor hash (Normal + 6 Pending + 6 Quarantine), template. Mandatory on v5.

**SQLite schema 6** for sessions (do not redefine schema 5). MAC session rows. One session per `(vault_id, outpoint)`. Reconcile from chain on boot.

**Recovery Kit** (not “Emergency Exit”): inspect all trees, initiate and claw back via live cosigners, claim serverlessly, verify before broadcast. Cannot exit Normal if both cosigners are gone.

On-chain encrypted descriptor: **later, own review.**

## Next implementation slices

1. Finish Normal 5-leaf tree + Go/TS goldens (Quarantine already differs Daily vs Savings).
2. Auth scripts that pin Pending dest + P2A.
3. Schema 6 + watcher.
4. Enroll + PoP.
5. All three initiate / clawback / claim paths + fee-race tests.
6. Recovery Kit CLI.
7. Keep v4 spend; v4→v5 sweep.

## Prompt for the other session

> Continue Arkade Vault v5 from `docs/vault-v5-staged.md` on branch `vault-mode`. Code start is `src/lib/vault/v5/` (`5e320ce`). Do not mint v4. Next: Normal 5-leaf tree and goldens, then enroll/PoP. Claims are serverless. P2A is locked. On-chain backup is out of scope for now.

## Full plan text

The rest of this file is the approved plan as of the handoff.

---

# Plan: Optional recovery + staged vault exits

## Goal

New enrollments are **v5 only**: phone, hardware, **required** recovery, and **staged** exits. Recovery is break-glass, not a Daily cosigner.

Single-key CSV on the **funded** vault is gone. Today `CSV(6)+hardware` is an attacker hatch: the clock is the UTXO’s age. After six confirms, stolen hardware sweeps Savings immediately. Same for phone@144 and any recovery@288 on the Normal output.

Staged protocol: constrained initiation → Pending whose CSV starts **now** → clawback to a **claimant-specific Quarantine**, or claim after the new delay.

**Recovery Kit** (not “Emergency Exit”) ships in the same release: downloadable public descriptor + offline CLI. Encrypted on-chain backup is a **later, separately reviewed** protocol. It must not gate v5.

Existing v4 UTXOs stay. Sweep them into v5. **Stop minting v4.**

## What Bitcoin CSV actually does

`OP_CHECKSEQUENCEVERIFY` is the age of **that** output, not time since someone clicked Recover. Mature Normal coins have no cancel window. Staging is what creates the window.

## Locked templates

| | Public schema | Recovery | Normal singlesig CSV |
|---|---|---|---|
| Legacy only | `arkade-vault/v4` | absent | hardware 6, phone 144 |
| New enrolls | `arkade-vault/v5` | **required** + PoP | **none** |

- Reject empty/null recovery on v5. No “skip recovery → v4.”
- Three keys are required so each Quarantine can **exclude the suspected key**.
- Wallet: template **registry** (today one pinned string).
- Keep three version axes separate: public descriptor schema, template string, **SQLite schema**.

## SQLite

**Schema 6.** Per-outpoint recovery sessions need a new table. Existing `schema_meta=5` is frozen; adding tables in place redefines a shipped version. v5→v6 backup/migrate. The existing `recovery_key_compressed` column can be reused; the session table is why we bump.

## v5 topology

For each **kind** (Daily, Savings) and each **claimant** (phone, hardware, recovery):

```
Quarantine(kind, claimant)
    ↓ pointed to by
Pending(kind, claimant)
    ↓ pointed to by
Normal(kind)
```

Build Quarantine first, then Pending, then Normal.

### Domain separation must change the address

Metadata in JSON does **not** split two identical `phone+hardware` trees. Daily and Savings quarantines with the same key pair would collide.

**Locked:** every tree uses a **context-derived NUMS internal key**, not the raw BIP341 NUMS.

Implemented: `taprootTweakPubkey(NUMS, tagged_hash("arkade-vault/v5/internal", length-prefixed vaultId‖kind‖claimant‖template))`.

Same Go/TS vectors. Quarantine(Daily, recovery) and Quarantine(Savings, recovery) are different taproots even when both are phone+hardware.

### Quarantine authority

| Suspected claimant | Quarantine 2-of-2 |
|---|---|
| Phone | hardware + recovery |
| Hardware | phone + recovery |
| Recovery | phone + hardware |

No singlesig on Quarantine. After clawback, rotate the bad key and admin-move to a **fresh** Normal.

### Normal Daily

```
routine 3-of-3(phone, tweak(Vault, daily-policy), tweak(Arkade, daily-policy))
admin: phone + hardware
initiate-phone / hardware / recovery: claimant + two tweaked cosigners → exact Pending(kind, claimant)
```

### Normal Savings

Same minus routine. Both policy cosigners sign Savings initiation and clawback.

No `CSV+*` and no `hardware+recovery` on Normal.

Initiation cannot pay an arbitrary dest. Auth scripts only allow: one input, exact Pending, full value − fee, P2A at index 1 value 0 script `51024e73`, packet, RBF sequence.

**Proofs:** hardware/recovery initiation use the Taproot PSBT signature, not PhoneDirectP256. Extra proofs if any bind network, vault id, kind, claimant, outpoint, unsigned tx, template.

Normal→Pending and Pending→Quarantine (except pending CSV) are cosigner withholding, one-of-two-honest.

### Pending (kind × claimant)

CSV starts when **this** output confirms.

| Pending | After new CSV | Clawback guardians |
|---|---|---|
| (kind, hardware) | `CSV(6)+hardware` | phone; recovery |
| (kind, phone) | `CSV(144)+phone` | hardware; recovery |
| (kind, recovery) | `CSV(288)+recovery` | phone; hardware |

Clawback: guardian + two cancel-policy tweaks → that Quarantine. Cancel stays valid after the deadline. First confirm wins.

Mature PendingRecovery claim is unrestricted dest. Say that.

### Cosigner tweaks

Collision-check every tweak against phone, hardware, recovery, both bases, **all** daily/initiate/cancel tweaks, NUMS, fixtures.

## Recovery PoP

BIP340 over vault id, invite handle, recovery x-only, complete v5 descriptor hash, template. Before invite consume.

## Watcher

Persistent **server-side** watcher plus out-of-band notify. Chain-derived `confirmedHeight` / `claimable`. States include `reorged | conflicted`.

## On-chain encrypted descriptor

Later. Do not ship x-only-hash share wrap. Needs KEM or enrollment secret, 32-byte key, unique nonces, AAD, explicit recovery wrap. Esplora cannot search OP_RETURN tags.

## Authorizer

Rebuild every descriptor. Initiate/clawback need both cosigners. Mature claim must not. Schema 6 MAC + chain reconcile.

## Deploy sequence

Wallet registry → snapshot DB → schema-6 authorizer enrollment disabled → verify funded v4 byte-for-byte → one v5 invite → keep v4 spend + v4→v5 sweep test.

## Order

1. Context NUMS + Quarantine/Pending + P2A (started in `src/lib/vault/v5/`).
2. Freeze Normal + all goldens (Go + TS).
3. Schema 6 + sessions.
4. Initiate / clawback / claim + fee-race + Mutinynet relay.
5. Recovery Kit.
6. v4 spend + sweep.
7. On-chain backup review (separate).

# Next program — waiting periods

The product is still Arkade Vault: this phone, hardware, vault service.
This file is the _next signer program_. Live Mutinynet still mints the
simpler vault. See [live.md](live.md). Voice: [voice.md](voice.md).

Once the signer cuts over, new vaults can add **optional** recovery.
Daily spend stays this phone, under the cap. If someone starts recovery,
a **new** waiting period begins. Cancel it if it wasn’t you. After the
wait, move the coins. There is no “wait out an old Savings coin”
shortcut for a stolen hardware key.

Engineers: client trees in `src/lib/vault/v5/`. Not an Ark VTXO wallet.
Mutinynet only.

## Why staging

`OP_CHECKSEQUENCEVERIFY` ages **that** UTXO. On v4, `CSV(6)+hardware` on
Savings is an attacker hatch: after six confirms, stolen hardware sweeps
immediately. v5 removes singlesig CSV from Normal. A claimant must first
create a **new** Pending output whose clock starts now. Guardians can send
that hold to a Quarantine that **excludes** the suspect.

## Accounts

| Account | Normal spend                       | Staged exit                            |
| ------- | ---------------------------------- | -------------------------------------- |
| Daily   | Routine 3-of-3 under the daily cap | initiate → Pending → clawback or claim |
| Savings | Admin: this device + hardware      | same staged graph, no routine leaf     |

Home shows two balances. Pending is a banner, not a third account.

## Keys

| Role               | What it is                                                                     |
| ------------------ | ------------------------------------------------------------------------------ |
| PhoneRoutineBIP340 | Browser software key, PRF-wrapped. Signs routine and phone initiate.           |
| PhoneDirectP256    | PRF-derived P-256. Signs the Arkade sighash. Not WebAuthn ES256.               |
| Hardware           | External owner wallet. Admin and hardware initiate.                            |
| Recovery           | Paper/break-glass. Required on v5. Starts a hold; does not spend Normal alone. |
| VaultCosigner      | Authorizer. Policy + anti-replay on initiate/clawback.                         |
| ArkadeCosigner     | Public emulator, tweaked with the auth script.                                 |

The passkey does not sign Bitcoin. WebAuthn proves origin / RP / UV off chain.

## Three version axes

Keep them separate.

| Axis                     | v4 leftover                                         | v5                               |
| ------------------------ | --------------------------------------------------- | -------------------------------- |
| Public descriptor schema | `arkade-vault/v4`                                   | `arkade-vault/v5`                |
| Template                 | `phone-direct-p256-routine-3of3-admin-phone-hww-v4` | `phone-hww-recovery-staged-v5`   |
| SQLite                   | schema 5 (issuance MAC)                             | schema 6 adds `recovery_session` |

Policy string `mandatory-change-tx50k-day100k-fee5k-feerate10-onchain-v3` is
the cap set, not the tree version.

## Clocks (Mutinynet demo)

| Claimant | Pending CSV |
| -------- | ----------- |
| hardware | 6           |
| phone    | 144         |
| recovery | 288         |

These are demo values. They are not production delays.

## What v5 does not do

- VTXOs (see the saved VTXO plan; out of this protocol)
- Auto-clawback or a watchtower that holds Cancel signatures
- Pre-signed Normal→Pending per UTXO
- On-chain encrypted descriptor backup
- Cancel back to the same Normal (that is phone+hardware again)

## Trust

Cosigners are one-of-two-honest for initiate and clawback. Mature claim is
**serverless**: CSV + claimant, dest unrestricted. Say that. If both
cosigners are gone, recovery cannot exit a Normal UTXO. Phone+hardware can
still Admin-exit Normal.

Browser watch of Pending addresses is best-effort. A six-block hardware hold
needs a persistent server-side watcher. That watcher is not shipped.

## Code map

| Path                                    | Role                                |
| --------------------------------------- | ----------------------------------- |
| `src/lib/vault/v5/trees.ts`             | Build Quarantine → Pending → Normal |
| `src/lib/vault/v5/spend.ts`             | Initiate / clawback / claim PSBTs   |
| `src/lib/vault/v5/route.ts`             | Classify script, pick executor      |
| `src/lib/vault/v5/replay.ts`            | Sign-once dest oracle (client copy) |
| `src/lib/vault/v5/kit.ts` / `kitCli.ts` | Recovery Kit                        |
| `src/lib/vault/v5/enroll.ts` / `pop.ts` | Recovery PoP                        |
| `src/lib/vault/v5/sweep.ts`             | Leftover v4 Daily → v5 Daily        |
| `src/lib/vault/spend.ts`                | v4/v5 Daily routine ceremony        |

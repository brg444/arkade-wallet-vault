# Live product

What people get on [the demo](https://arkade-vault-demo.vercel.app) today:
Spending on this phone, Savings with hardware, daily limits. Recovery is
optional. Skip it and the signer still mints v5 (this device plus
hardware). Add a recovery key and it is a third guardian. How we say
that: [voice.md](voice.md).

What Railway `authorizer-next` actually runs (engineers):

Enroll template `phone-hww-recovery-staged-v5` (recovery optional).  
Leftover template `phone-direct-p256-routine-3of3-admin-phone-hww-v4` (no new mints; recover those coins out of band).  
Policy `mandatory-change-tx50k-day100k-fee5k-feerate10-onchain-v3`.  
SQLite schema 6 (`recovery_session`). Network Mutinynet.

## Trees (new enrolls)

Daily (Operational):

1. Routine 3-of-3: PhoneRoutineBIP340 + tweaked VaultCosigner + tweaked ArkadeCosigner
2. Admin 2-of-2: this device + hardware
3. Initiate per guardian (phone, hardware, and recovery if present)

Savings: admin + the same initiate leaves. No routine. No singlesig CSV
on Normal.

Skip recovery → 10-tree family (phone + hardware).  
Add recovery → 14-tree family (phone + hardware + recovery).

A claimant must first create a **new** Pending output whose clock starts
now. Guardians can send that hold to a Quarantine that excludes the
suspect. Hardware cannot sweep a mature Savings coin after six confirms
on that coin.

## Ceremony

Passkey does not sign Bitcoin. WebAuthn is origin / RP / UV. DirectP256
(PRF) signs the Arkade sighash. PhoneRoutine is a browser software key
encrypted under the PRF.

Routine HTTP: draft → preflight → bind → authorize → publish. The
authorizer rebuilds the leaf, checks dest/change/fee/WebAuthn/DirectP256,
reserves budget, then uses VaultCosigner.

Savings: device + hardware PSBT (QR / `HwSign`). No VaultCosigner.

## Client rules

- Reject G and 2G as hardware on Mutinynet
- Reject leftover v3 templates on enroll
- Pin deposit addresses after enroll finish (no first-seen TOFU)
- Hash the proposed **v5** descriptor; do not accept a leftover v4 propose
- Independently rebuild Daily and Savings from the family

## Claims (live)

| Claim                                                         | Status                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Network caller bypasses policy via a generic Mutinynet signer | Closed. Constrained authorizer + one pinned outbound Arkade call |
| VaultCosigner use is bound to WebAuthn, tx, and budget        | Yes, on Routine                                                  |
| Host/root cannot take VaultCosigner                           | No. Process isolation, not an HSM                                |
| Same-origin XSS is tolerated                                  | No. Unlocked PhoneRoutine / PRF are stealable                    |
| Browser reconciles the Arkade sighash                         | Yes, one-input Routine template                                  |
| Browser derives the full Daily descriptor                     | Both sides rebuild the v5 family (10 or 14 trees)                |
| Hardware key gen lives in this repo                           | No. Hardware is an independent pubkey + WIF/hex sign             |
| Cosigner stages are crash-atomic                              | Staged: reserved → vault_signed → completed                      |
| Mainnet / one vault per process                               | No mainnet. Live is invite multi-tenant                          |

## Leftovers

Existing v4 rows still load so those coins can be spent or recovered
manually. Exact v3 template `phone-direct-p256-routine-3of3-admin-2of2-v3`
may sit quarantined on the multi-tenant ledger. The compiled kiosk
addresses are that empty singleton. Do not seed Receive from them.
Do not mint v4.

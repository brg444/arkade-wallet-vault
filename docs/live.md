# Live product

What people get on [the demo](https://arkade-vault-demo.vercel.app) today:
Spending on this phone, Savings with hardware, daily limits. Recovery is
optional. Skip it and the signer mints v4 (no recovery on those coins).
Add a recovery key and it mints v5. How we say that: [voice.md](voice.md).

What Railway `authorizer-next` actually runs (engineers):

Default enroll template `phone-direct-p256-routine-3of3-admin-phone-hww-v4`.  
Optional enroll template `phone-hww-recovery-staged-v5`.  
Policy `mandatory-change-tx50k-day100k-fee5k-feerate10-onchain-v3`.  
SQLite schema 6 (`recovery_session`). Network Mutinynet.

## Trees

Daily (Operational):

1. Routine 3-of-3: PhoneRoutineBIP340 + tweaked VaultCosigner + tweaked ArkadeCosigner
2. Admin 2-of-2: this device + hardware
3. CSV + this device (144)
4. CSV + hardware (6)

Savings: admin + the same two CSV leaves. No routine. No RecoveryKey.

Hardware can move first. On a mature Savings coin, stolen hardware does
not wait for a new clock. That is the v5 reason.

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
- Reject `recoveryKeyPub` and leftover v3 templates
- Pin deposit addresses after enroll finish (no first-seen TOFU)
- Hash the proposed descriptor; do not reconstruct Daily `Q` from keys
- Independently build the Savings tree and check the address

## Claims (live)

| Claim                                                         | Status                                                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------- |
| Network caller bypasses policy via a generic Mutinynet signer | Closed. Constrained authorizer + one pinned outbound Arkade call |
| VaultCosigner use is bound to WebAuthn, tx, and budget        | Yes, on Routine                                                  |
| Host/root cannot take VaultCosigner                           | No. Process isolation, not an HSM                                |
| Same-origin XSS is tolerated                                  | No. Unlocked PhoneRoutine / PRF are stealable                    |
| Browser reconciles the Arkade sighash                         | Yes, one-input Routine template                                  |
| Browser derives the full Daily descriptor                     | v4: hashes the proposed blob; Savings rebuilt. v5: both sides rebuild the 14-tree family |
| Hardware key gen lives in this repo                           | No. Hardware is an independent pubkey + WIF/hex sign             |
| Cosigner stages are crash-atomic                              | Staged: reserved → vault_signed → completed                      |
| Mainnet / one vault per process                               | No mainnet. Live is invite multi-tenant                          |

## Leftovers

Exact v3 template `phone-direct-p256-routine-3of3-admin-2of2-v3` may sit
quarantined on the multi-tenant ledger. The compiled kiosk addresses are
that empty singleton. Do not seed Receive from them.

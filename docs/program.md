# Vault Program

The current enrollment template is `phone-hww-recovery-savings-v1`, and its
descriptor schema is `arkade-vault/savings-v1`; together they identify the
Savings-only L1 program. Spending uses the separate `vault-policy-v1` VTXO
program, while database versions, templates, programs, and digest domains
remain independent contracts.

The server and wallet pin the same machine-readable values in
[`contract-pack.json`](../src/lib/vault/contract-pack.json) and verify the same
canonical Savings vectors.

## Enrollment policy instance

The program is fixed, but each vault freezes a protection tier and supported
numeric policy. Standard forbids a recovery key; Advanced requires one.
Onboarding offers Lower exposure (25,000 sats per payment and 50,000 sats per
rolling 24 hours), Everyday (50,000 and 100,000), or custom values for those
two fields. The 5,000-sat absolute fee ceiling and 10 sat/vB feerate ceiling
remain release-managed and are not ordinary setup controls. The wallet commits
the exact tier and policy digest before creating the passkey and accepts only
an exact service echo and reconstructable descriptor.

The policy digest is retained in the staged enrollment, local program pin, and
Recovery Kit. The two fee ceilings also affect the Savings transition scripts,
so a vault enrolled with different ceilings has a different Savings
descriptor. There is no post-enrollment edit path. Destination rules,
arbitrary policy code, and additional programs are not part of this schema.

## Spending

Spending is VTXO-only and has no L1 Daily account. The collaborative
`vault-policy-v1` leaf requires the phone, VTXO VaultCosigner, and Arkade
Operator. The Vault service independently verifies the complete Arkade
transaction and checkpoints and enforces recipient, fee, and rolling 24-hour
allowance policy from that vault's immutable instance before signing.

An ordinary send begins with a phone-signed, idempotent reservation. The user
then authorizes the transaction-bound digest. The two ceremonies are separate:
the first prevents an unauthenticated caller from locking the vault's VTXO,
while the second approves the exact transaction built from the reservation.

The current Mutinynet spend shape uses between one and 50 canonical inputs, one
destination, optional `vault-policy-v1` change, and P2A. The wallet reserves
the operation before Review so the user sees the exact Operator fee. It binds
the fee-policy digest and rejects drift before every remaining signing or
submission stage.

## Savings

Savings is the only L1 balance in a fresh vault. Its ordinary admin leaf
requires the phone and hardware keys. The VaultCosigner has no routine path to
pay an arbitrary Savings recipient.

Moving Savings to Spending pays the exact enrolled boarding address. The
only supported program is `vault-board-v1`. After the output confirms, the
official SDK settles it to the advertised `vault-policy-v1` Arkade address. A
Savings withdrawal to another Bitcoin address remains an external PSBT
workflow.

## Recovery

Standard has phone and hardware recovery claimants but no recovery key.
Advanced also includes the recovery-key claimant. The enrolled program can
begin a new Pending output for an enrolled claimant. The current Mutinynet delays
are 144, 6, and 288 blocks respectively. Those values begin when the Pending
output confirms; the age of the original Savings output does not satisfy them.

The remaining guardians can claw a Pending output into a Quarantine tree before
the claimant matures. A matured claimant may recover through the committed
claim path. The in-app watcher is local best-effort polling, not a watchtower.

Face ID is a local user-verification ceremony, not a Bitcoin key. Production
screens never request raw hardware or recovery private keys. They export and
import PSBTs so an external signer can preserve the custom tapscript data and
approve the intended leaf.

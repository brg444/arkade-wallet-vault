# Arkade Vault v5 transactions

Canonical wallet builders: `src/lib/vault/v5/`. Reconstruct every tree from the public descriptor. Do not trust client scripts or addresses.

This is the L1 staged vault. It is not an Ark VTXO. Do not register these scripts with `ContractManager`.

## Graph

```
Normal(kind)
    --initiate(claimant + 2 cosigners)--> Pending(kind, claimant)
Pending
    --clawback(guardian + 2 cosigners)--> Quarantine(kind, claimant)
    --claim(CSV + claimant only)-------> any dest
Quarantine
    --rotate(2-of-2 excluding claimant)--> fresh Normal
```

`kind` is `daily` or `savings`. `claimant` is `phone`, `hardware`, or `recovery`.

CSV starts when **that Pending** confirms. It is not the age of the original Normal UTXO.

| Suspected claimant | Quarantine 2-of-2 |
| --- | --- |
| phone | hardware + recovery |
| hardware | phone + recovery |
| recovery | phone + hardware |

Daily Normal also has a routine 3-of-3 (phone + two policy-tweaked cosigners). Savings Normal does not.

## Shared transition rules (initiate and clawback)

- version `2`, locktime `0`
- exactly one input, sequence `0xfffffffd` (`TRANSITION_SEQUENCE`; `0xffffffff` forbidden)
- outputs, in order:
  1. dest p2tr (Pending or Quarantine)
  2. funded P2A: script `51024e73`, value `240`
  3. zero-value emulator packet
- dest value = input − fee − `240`, at least dust
- fee bump keeps dest script and input set, raises fee (`bumpTransitionFee`)

Cosigners are an anti-replay oracle for `initiate` and `clawback` only. Key: `(vault_id, outpoint, purpose)`. Same dest + same input + higher fee → re-sign. Different dest or extra input → refuse. Never sign `claim`.

## initiate

Spends Normal `initiate-{claimant}` leaf. Dest is **that** Pending script. Phone initiate may bind PhoneDirectP256 in the packet. Hardware and recovery must not require WebAuthn.

Route: `l1Initiate`. Purpose `exit`, or `recover` when claimant is recovery.

## clawback

Spends a Pending clawback leaf. Guardian is not the claimant. Dest is **that** Quarantine (excludes the suspect). Valid before and after the Pending CSV. First confirm wins.

Route: `l1Clawback`.

## claim

Spends the Pending CSV leaf. Sequence is the claimant delay (hardware `6`, phone `144`, recovery `288` on Mutinynet). One output, dest **not** pinned. No authorizer signature. Claimant can RBF their own tx. No P2A required.

Route: `l1Claim`.

## pay (Daily only)

Existing v4-style routine ceremony on Daily Normal. Do not initiate in order to pay. Do not mix with a VTXO input.

Route: `l1RoutineCeremony`. Purpose `spend`.

## admin

Phone + hardware on Daily or Savings Normal. Immediate. Does not create Pending.

Route: `l1AdminPsbt`.

## quarantine-rotate

Phone/hardware/recovery 2-of-2 **excluding** the suspected claimant. Pays a **new** Normal after key rotation. Do not return to the old Normal (that is phone+hardware again).

Route: `l1QuarantineAdmin`.

## Classification

`classifyScript(family, script)` in `src/lib/vault/v5/route.ts`. Unknown script is a hard error. `selectRoute` is not policy authority: the authorizer still rebuilds dest, P2A, and inputs.

## Out of this document

VTXO board/send/exit, on-chain encrypted backup, auto-clawback, pre-signed Normal→Pending, Cancel back to Normal.

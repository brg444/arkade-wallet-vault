# Recovery Kit

Optional. Download it at enroll whether or not a recovery key was added.
Not required for leftover v4 Savings (recover those out of band). Name it
Recovery Kit, not Emergency Exit. It is the public v5 family plus enough
to finish a hold without the PWA.

The file is JSON: `{ name: "arkade-recovery-kit", version: 1, descriptor, descriptorHash }`.
No PhoneRoutine secret. No hardware WIF. No PRF.

Download it at enroll and after any key rotation. Settings → Recover.

## What it can do

| Action | Needs live cosigners? | Notes |
| --- | --- | --- |
| Inspect all 14 trees | No | Verifies the hash against a rebuilt descriptor |
| Status | No (Esplora) | Remaining CSV from **Pending** confirm height |
| Initiate | Yes | Dest pinned to that Pending + P2A |
| Clawback | Yes | Dest pinned to Quarantine that excludes the suspect |
| Claim | No | After the Pending CSV. Dest is **not** pinned |
| Verify / bump | No | Bump keeps dest and input set, raises fee |

It cannot take a Normal UTXO if both cosigners are gone. Phone + hardware can
still Admin-exit Normal from the wallet.

## Honest limits

- A mature Pending **recovery** claim can pay any address. The UI may suggest
  a new vault. A hostile recovery key can ignore that.
- Every initiate is an alert. The kit does not auto-clawback.
- Browser-only watch can miss a six-block hardware hold.

## Offline CLI

See [v5-api.md](v5-api.md) for flags. Example:

```bash
bun scripts/vault-recovery-kit.ts inspect ~/arkade-recovery-kit.json
```

Build a clawback of a stolen-hardware hold:

```bash
bun scripts/vault-recovery-kit.ts clawback ~/arkade-recovery-kit.json \
  --kind savings --claimant hardware --guardian phone \
  --txid <pending-txid> --vout 0 --value <sats> --fee 800
```

The suspect cannot be the guardian.

## In the app

Recover builds the same PSBTs (`src/lib/vault/v5/recoverFlow.ts`) and copies
them. Cosigning and broadcast still go through the live authorizer / Esplora
once those endpoints exist. Until then the PSBT is the handoff.

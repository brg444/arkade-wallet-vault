# How the Vault Program is built

This release enrolls one program, stored as
`phone-hww-recovery-staged-v6`. That string is a template id, not a
schema integer and not a release. Schema, program, and HMAC/HKDF
domains are independent — see
[arkade-vault-server/docs/versions.md](https://github.com/brg444/arkade-vault-server/blob/main/docs/versions.md).

The program can cancel a pending recovery with the remaining user keys. The
in-app pending watcher is best-effort local polling, not a watchtower.

Per-transaction, fee, and recursive-change rules are enforced by script
and by the server. Only the rolling 24-hour allowance is server-only.

The current deployment remains a Mutinynet release candidate. Real-fund use
begins only after the mainnet release gates close.

Recovery is optional. Skip it: this device and hardware. Add a recovery
key: a third person who can start a wait, not spend everyday coins
alone.

The names are pinned in
[`src/lib/vault/contract-pack.json`](../src/lib/vault/contract-pack.json).
The service has the same file.

## What each key is for

| Who                  | What they can do                                                           |
| -------------------- | -------------------------------------------------------------------------- |
| This device          | Daily spend (with the service), and start recovery as this device          |
| Hardware             | Savings and full sweep, with this device. Can start recovery as “hardware” |
| Recovery (optional)  | Start a waiting period. Cannot spend everyday coins alone                  |
| Vault service        | Cosign daily spend, and cosign start/cancel of recovery                    |
| Public Arkade signer | The other cosignature on those same steps                                  |

Face ID is not a Bitcoin key. It proves you are at this site.

## Daily and Savings

**Daily.** Spend with Face ID, under a limit. The Bitcoin path is this
device plus the two services.

**Savings.** This device and hardware together. No daily path.

Stolen hardware cannot sweep a Savings coin just because that coin is
old. They have to start a **new** wait. You can cancel that wait and
send the coin to a hold that leaves them out.

The release pins its recovery waits in the descriptor: hardware 6 blocks, this
device 144 blocks, and recovery 288 blocks.

The vault app and the service independently build exact scripts from the same
public description.

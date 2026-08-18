# How a vault is built

New vaults use the **staged program**, stored as
`phone-hww-recovery-staged-v6`. That string is a template id, not a
schema integer and not a release. Schema, program, and HMAC/HKDF
domains are independent — see
[arkade-vault-server/docs/versions.md](https://github.com/brg444/arkade-vault-server/blob/main/docs/versions.md).

Recovery is optional. Skip it: this device and hardware. Add a recovery
key: a third person who can start a wait, not spend everyday coins
alone.

The names are pinned in
[`src/lib/vault/contract-pack.json`](../src/lib/vault/contract-pack.json).
The service has the same file.

## What each key is for

| Who | What they can do |
| --- | --- |
| This device | Daily spend (with the service), and start recovery as this device |
| Hardware | Savings and full sweep, with this device. Can start recovery as “hardware” |
| Recovery (optional) | Start a waiting period. Cannot spend everyday coins alone |
| Vault service | Cosign daily spend, and cosign start/cancel of recovery |
| Public Arkade signer | The other cosignature on those same steps |

Face ID is not a Bitcoin key. It proves you are at this site.

## Daily and Savings

**Daily.** Spend with Face ID, under a limit. The Bitcoin path is this
device plus the two services.

**Savings.** This device and hardware together. No daily path.

Stolen hardware cannot sweep a Savings coin just because that coin is
old. They have to start a **new** wait. You can cancel that wait and
send the coin to a hold that leaves them out.

Demo waits (Mutinynet, not real-world delays): hardware 6 blocks, this
device 144, recovery 288.

The vault app and the service each build the vault from the same public
description. They do not copy scripts from each other.

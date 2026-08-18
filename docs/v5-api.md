# Arkade Vault v5 API

**Next product spec** for enroll/initiate/clawback. Live HTTP today still
serves **v4** descriptors on propose. Routine draft/preflight/bind/authorize/publish
is live for leftover v4 Daily.

The page never embeds the authorizer origin in production. It calls `/v1` on
its own host. Vercel adds `X-Vault-Gateway-Secret` and proxies only
allowlisted paths. Origin is a CSRF filter, not authentication.

Authorizer must **rebuild** descriptors from canonical inputs. Never trust
client scripts, addresses, or hashes.

## HTTP (live, v4 leftover + v5 enroll client)

Enrollment is invite-gated.

| Method | Path | Role |
| --- | --- | --- |
| GET | `/health` | Liveness |
| GET | `/v1/status?vault=` | Public-enough status. Pin addresses locally after finish. |
| POST | `/v1/enroll/start` | Header `X-Vault-Enrollment-Token` |
| POST | `/v1/enroll/propose` | WebAuthn attestation + hardware + recovery x-only |
| POST | `/v1/enroll/finish` | Same tuple + `recoveryPoP` + `descriptorHash` |
| POST | `/v1/passkey/challenge` | Other-device sign-in |
| POST | `/v1/passkey/binding` | |
| POST | `/v1/passkey/install` | |
| POST | `/v1/passkey/recover` | |
| POST | `/v1/draft` | Daily routine PSBT |
| POST | `/v1/preflight` | Arkade challenge |
| POST | `/v1/bind` | PhoneDirectP256 + WebAuthn assertion |
| POST | `/v1/authorize` | Two BIP340 cosignatures |
| POST | `/v1/publish` | Broadcast authorized tx |

`POST /v1/register` is not on the Mutinynet authorizer (404/405).

### Enroll

Recovery is optional.

- No recovery key → propose returns a rebuilt **v4** descriptor.
- Recovery x-only supplied → propose returns a rebuilt **v5** descriptor.
  `finish` then sends BIP340 `recoveryPoP` over
  `tagged_hash("arkade-vault/v5/recovery-pop", vaultId ‖ invite handle ‖ recovery x-only ‖ descriptor hash ‖ template)`.

Skip recovery is a v4 vault. It is not an error.

### Daily pay

Unchanged ceremony: draft → preflight → Face ID → bind → authorize → publish.
`selectRoute` only allows this from Daily Normal. Do not initiate in order to
pay.

### Initiate / clawback (authorizer, not fully live)

Sign-once oracle. Key `(vault_id, outpoint, purpose)` with purpose
`initiate` or `clawback` only.

- Same dest + same input + higher fee → re-sign
- Same sighash → same signature
- Different dest or extra input → nothing
- Never sign `claim`

Wallet copy: `src/lib/vault/v5/replay.ts`. Authorizer copy (schema 6):
`recovery_session` + `DecideReplay` on the Go ledger.

Claim is serverless. The authorizer must not be required after Pending
matures.

## Route table

`selectRoute` / `classifyScript` in `src/lib/vault/v5/route.ts`.

| Intent | Allowed coins | Executor |
| --- | --- | --- |
| `pay` | Daily Normal | `l1RoutineCeremony` |
| `admin` | Daily or Savings Normal | `l1AdminPsbt` |
| `initiate` | Normal | `l1Initiate` |
| `clawback` | that Pending, guardian ≠ claimant | `l1Clawback` |
| `claim` | that Pending (CSV if heights given) | `l1Claim` |
| `quarantine-rotate` | that Quarantine | `l1QuarantineAdmin` |

Unknown script is a hard error. L1 trees are not ContractManager contracts.

## Recovery Kit CLI

```bash
bun scripts/vault-recovery-kit.ts inspect kit.json
bun scripts/vault-recovery-kit.ts status kit.json --kind savings --claimant hardware --esplora https://mutinynet.com/api --txid <txid> --vout 0
bun scripts/vault-recovery-kit.ts initiate kit.json --kind daily --claimant hardware --txid <txid> --vout 0 --value <sats> --fee 500
bun scripts/vault-recovery-kit.ts clawback kit.json --kind savings --claimant hardware --guardian phone --txid <txid> --vout 0 --value <sats> --fee 500
bun scripts/vault-recovery-kit.ts claim kit.json --kind savings --claimant hardware --dest tb1p… --txid <txid> --vout 0 --value <sats> --fee 500
bun scripts/vault-recovery-kit.ts verify <psbt-hex-or-file>
bun scripts/vault-recovery-kit.ts bump <psbt-hex-or-file> --fee <higher>
```

`status --esplora` derives claimable from chain height. Do not persist
`claimable` as irreversible.

## Leftover v4 sweep

Settings → Recover → Sweep leftover v4. Daily only. Source is the v4
operational address. Dest is the v5 Daily address. Uses the existing routine
ceremony. Savings leftover is not this path.

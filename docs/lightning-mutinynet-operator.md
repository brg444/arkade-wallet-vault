# Mutinynet LND solver — operator runbook

This is the Mutinynet **Arkade → Lightning SEND** solver for Vaulted RC.
Lightning receive stays disabled. Mainnet is not in scope.

Do not copy this layout onto a public IP. The admin console has no
authentication. `ADMIN_HOST` must remain `127.0.0.1` and must be reached
only through an authenticated private tunnel.

## What this release enables

| Corridor | State |
| --- | --- |
| Arkade → Lightning send | enabled |
| Lightning → Arkade receive | **disabled** |
| `LN_RECEIVE_ACCEPT_UNILATERAL_GAP` | **must stay `false`** |
| Network | Mutinynet only |

Vaulted Spending authorizes and funds the lockup under existing vault
limits. The solver only performs the swap. It must not be given a path
into Savings or a way around Spending policy.

LND is the production baseline. Do not switch this release to Spark.

## External actions still required

This repository does **not** contain Mutinynet LND credentials, a funded
channel, or a live solver URL. Before a live RC smoke test someone with
operator access must:

1. Provision a dedicated solver Arkade wallet (new BIP39 mnemonic, never
   reused from Vaulted or from a public example).
2. Provision an isolated LND node (or an isolated LND wallet + macaroon)
   on Mutinynet, funded, with an operational channel.
3. Place `tls.cert` and a **invoice/send-restricted** macaroon (or the
   documented admin macaroon if finer macaroons are not yet issued) on
   the solver host at runtime. Do not bake them into the image or this
   repo.
4. Confirm Mutinynet Esplora and Emulator URLs from the live Arkade
   deployment — do not invent them. The solver example file names:

   - Arkade operator: `https://mutinynet.arkade.sh`
   - Esplora: `https://mempool.mutinynet.arkade.sh/api`

   Emulator URL has **no default** on Mutinynet and must be supplied.
5. Build the solver image from `https://github.com/arkade-os/intent-solver`
   (`docker build -f packages/solver-app/Dockerfile .`). No published
   GHCR image was reachable without auth at the time of this pin.
6. After the process is up, generate the registry card from **that**
   process and independently verify discovery pubkey, corridor, relays,
   min/max, fee, network, and the solver key used in VHTLC derivation
   before replacing Vaulted’s bundled card.

## Security properties

- Dedicated solver wallet (`ARK_MNEMONIC` at runtime only).
- Isolated LND node or isolated wallet/credentials.
- Conservative `MAX_SWAP_SATS` and `MAX_EXPOSED_SATS` (see recommended
  values below).
- `LN_SEND_ENABLED=true`, `LN_RECEIVE_ENABLED=false`.
- `ADMIN_HOST=127.0.0.1`. No public inbound admin port.
- Persistent `SWAP_DB_PATH` on a backed-up volume.
- Explicit `ARK_ESPLORA_URL`, `LND_ESPLORA_URL`, `EMULATOR_URL`,
  `SWAP_NETWORK=mutinynet`.
- `restart: unless-stopped` and structured logs.
- Secrets via env/files at runtime; never in the image, git, or logs.

## Recommended Mutinynet caps

These are RC values, not mainnet values.

| Knob | Recommended | Why |
| --- | --- | --- |
| `MAX_SWAP_SATS` | `25000` | Matches the bundled card quote max. |
| `LN_SEND_MAX_SATS` | `25000` | Same corridor ceiling Vaulted already pins. |
| `MAX_EXPOSED_SATS` | `75000` | 3 × max swap; limits concurrent lockups. |
| `LN_SEND_FEE_BPS` | `30` | Matches the bundled card until the live card is regenerated. |
| Solver hot-wallet float | ≥ `150000` sats | Covers 2× exposed cap plus fees. |
| LND hot-wallet / channel | ≥ `200000` sats outbound | Channel plus routing buffer; do not keep unused surplus. |

## Dry-run

From this repository:

```bash
bash scripts/validate-mutinynet-solver.sh
```

The script checks manifests, refuses committed secrets, and confirms
receive remains disabled. It cannot prove a live swap without the
external LND node.

## Rollback

1. Set `LN_SEND_ENABLED=false` (or stop the container).
2. Leave the database volume intact so funded lockups remain refundable.
3. Do not rotate `ARK_MNEMONIC` while non-terminal rows exist.
4. Vaulted rollback is the previous RC bundle with Lightning send off
   (`VITE_VAULT_LIGHTNING_SEND` not `true`).

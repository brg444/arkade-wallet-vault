# Lightning SEND mainnet-readiness (receive remains disabled)

This report does **not** enable mainnet Lightning. It does **not** set
`LN_RECEIVE_ACCEPT_UNILATERAL_GAP=true`. Lightning receive stays off.

## What is implemented

- Arkade → Lightning SEND only, Mutinynet-gated.
- Local BOLT11 parse, network/expiry checks, spending-cap and fee ceiling.
- Bundled, signature-verified Mutinynet solver card (no runtime registry follow).
- Dual VHTLC derivation: eight-leaf (`lightningSendVtxoScript`) and nine-leaf
  (`nonInteractiveRefund.withoutReceiver`). Fund only on exact address match.
- `client_refund_pubkey` is the persistent phone identity.
- Per-vault Web Lock, persistent RFQ/funding state, quote revalidation,
  unsigned observer, passkey-gated collaborative refund.

## Dependency pin

| Package | Pin |
| --- | --- |
| `@arkade-os/swap` | `0.0.10` (npm) |
| `@arkade-os/sdk` | vendored `f0fd58d5` + 0.4.67 VHTLC/refund-key cherry-picks (`vendor/arkade-os-sdk.tgz`) |

Published npm `0.4.67` cannot be used as-is: it drops Vaulted’s boarding seam.
Published `0.4.68` / swap `0.0.11` refactor VHTLC to `nonInteractiveParameters`
and are not what the current intent-solver quotes.

## Recommended Mutinynet caps (not mainnet)

| Knob | Value |
| --- | --- |
| `MAX_SWAP_SATS` | 25,000 |
| `LN_SEND_MAX_SATS` | 25,000 |
| `MAX_EXPOSED_SATS` | 75,000 |
| Solver Arkade float | ≥ 150,000 sats |
| LND outbound / channel | ≥ 200,000 sats |

Mainnet caps are **not** recommended until live Mutinynet SEND, refund, and
unilateral recovery have been proven at these values.

## Solver liquidity and LND exposure

- Dedicated solver Arkade wallet; never the user’s Spending/Savings keys.
- Isolated LND node or isolated wallet + macaroon.
- Hot-wallet exposure is `MAX_EXPOSED_SATS` plus in-flight Lightning HTLCs.
- Do not keep surplus in the LND wallet beyond channel reserve + one extra
  max-swap.

## Database backup and restore

- `SWAP_DB_PATH` is the money-critical file (plus `-wal`/`-shm`).
- Snapshot at least every few minutes (SQLite online backup or litestream).
- Restore drill: stop solver, restore the file onto a staging host, start,
  confirm non-terminal rows resume. Do not rotate `ARK_MNEMONIC` across that
  restore.
- **Status: drill not yet executed in this RC pass.**

## Macaroon permissions

Prefer an invoice/send-restricted macaroon over admin. The Mutinynet example
currently documents admin macaroon paths because that is what LND deployments
commonly mount; tightening this is an open operator task.

## Admin access

- `ADMIN_HOST=127.0.0.1`
- No public inbound admin port
- Reach only through an authenticated private tunnel
- The console has no application authentication

## Monitoring and alerts

| Signal | Threshold |
| --- | --- |
| Relay heartbeat age | > 60s = unhealthy |
| Swap DB backup age | > 10 min = page |
| Exposed sats | > 80% of `MAX_EXPOSED_SATS` = page |
| Failed send rate | > 20% over 15 min = investigate |
| VTXO expiry (chain tip fetch) | any “height-based expiry will not be evaluated” = page |
| Quote → fund timeout | approaching `LOCKUP_TIMEOUT_SECONDS` with no txid |

## VTXO expiry

Both `ARK_ESPLORA_URL` and `LND_ESPLORA_URL` must be set. A green container
healthcheck is not proof that expiry is watched.

## Refund evidence required before mainnet

| Path | Status in this pass |
| --- | --- |
| Collaborative covenant refund (`nonInteractiveRefund`) | unit-level; **no live Mutinynet evidence** |
| Client-only unilateral refund reconstruction | unit-level restore of the nine-leaf tree; **no live unroll** |
| Failed payment becoming refundable | lifecycle unit tests; **no live invoice failure** |

## Incident / rollback

1. Disable `LN_SEND_ENABLED` or stop the solver container.
2. Keep the database volume.
3. Do not rotate the solver mnemonic while rows are non-terminal.
4. Wallet rollback: previous RC bundle with `VITE_VAULT_LIGHTNING_SEND` unset.
5. Do not enable Lightning receive as a “fix”.

## Exact remaining blockers

1. No live Mutinynet LND node, emulator URL confirmation, or solver mnemonic
   was available in this session. Manifests are dry-run only.
2. No published GHCR `intent-solver` image without auth; local image build is
   required.
3. Bundled solver card must be replaced only after a live Mutinynet solver
   generates a card that independently matches pubkey, corridor, relays,
   min/max, fee, network, and covenant solver key.
4. Live value-flow proof (quote → local derive → fund → preimage matches
   invoice payment hash) is still outstanding.
5. Live collaborative and unilateral refund proofs are still outstanding.
6. RC wallet deploy with `VITE_VAULT_LIGHTNING_SEND=true` was not performed
   (Mutinynet only, never mainnet).
7. Physical Face ID / PWA Lightning smoke is still outstanding.
8. Spark remains out of this release (`route_cltv_uncappable`).

## Explicitly disabled

- Mainnet Lightning send
- Lightning receive (`LN_RECEIVE_ENABLED=false`)
- `LN_RECEIVE_ACCEPT_UNILATERAL_GAP` remains `false`

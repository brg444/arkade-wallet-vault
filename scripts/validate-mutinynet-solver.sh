#!/usr/bin/env bash
# Dry-run validation for the Mutinynet LND solver manifests.
# Does not contact LND, does not print secrets, does not deploy.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$ROOT/deploy/mutinynet-lnd-solver/compose.yml"
ENV_EXAMPLE="$ROOT/deploy/mutinynet-lnd-solver/env.example"
FAIL=0

fail() { echo "FAIL: $*" >&2; FAIL=1; }
ok() { echo "OK: $*"; }

test -f "$COMPOSE" || fail "missing $COMPOSE"
test -f "$ENV_EXAMPLE" || fail "missing $ENV_EXAMPLE"

grep -q "LN_RECEIVE_ENABLED: 'false'" "$COMPOSE" || fail "compose must disable LN receive"
grep -q "LN_RECEIVE_ACCEPT_UNILATERAL_GAP: 'false'" "$COMPOSE" || fail "compose must not accept the receive unilateral gap"
grep -q "ADMIN_HOST: 127.0.0.1" "$COMPOSE" || fail "compose must bind admin to loopback"
grep -q "LN_BACKEND: lnd" "$COMPOSE" || fail "compose must use LND, not Spark"
grep -q "command: \['relay'\]" "$COMPOSE" || fail "compose must use relay ingress"
if grep -E "^\s+-\s+[0-9]" "$COMPOSE" | grep -q .; then
  fail "compose must not publish inbound ports"
else
  ok "no published inbound ports"
fi

grep -q '^LN_RECEIVE_ENABLED=false$' "$ENV_EXAMPLE" || fail "env.example must disable LN receive"
grep -q '^LN_RECEIVE_ACCEPT_UNILATERAL_GAP=false$' "$ENV_EXAMPLE" || fail "env.example must keep receive unilateral gap false"
grep -q '^SWAP_NETWORK=mutinynet$' "$ENV_EXAMPLE" || fail "env.example must select mutinynet"
grep -q '^LN_BACKEND=lnd$' "$ENV_EXAMPLE" || fail "env.example must select lnd"
grep -q '^ADMIN_HOST=127.0.0.1$' "$ENV_EXAMPLE" || fail "env.example must keep admin on loopback"
grep -q '^ARK_MNEMONIC=$' "$ENV_EXAMPLE" || fail "env.example must not ship a mnemonic"
if grep -E '^[A-Z0-9_]*(MNEMONIC|MACAROON|CERT)=' "$ENV_EXAMPLE" | grep -v '=$' | grep -v '_PATH=' | grep -q .; then
  fail "env.example contains a filled secret"
else
  ok "env.example secrets are empty"
fi

if git -C "$ROOT" grep -I -E '^[A-Z0-9_]*(MNEMONIC|MACAROON)=' -- deploy docs scripts >/dev/null 2>&1; then
  filled="$(git -C "$ROOT" grep -I -E '^[A-Z0-9_]*(MNEMONIC|MACAROON)=' -- deploy docs scripts | grep -v '=$' || true)"
  if [ -n "$filled" ]; then
    fail "committed secret assignment"
  fi
fi

ok "receive corridor disabled"
ok "admin loopback"
ok "LND backend"
ok "mutinynet network"

if [ "$FAIL" -ne 0 ]; then
  echo "Mutinynet solver manifests are not ready." >&2
  exit 1
fi
echo "Dry-run passed. External action still required: funded isolated LND, emulator URL, solver mnemonic, and a locally built intent-solver image."

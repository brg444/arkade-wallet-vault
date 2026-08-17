#!/bin/sh
# Local authorizer for vault-mode wallet (http://localhost:3003).
# Requires Go 1.26+ and a checkout of arkade-2fa-vault-poc.
# Fixture G/2G pubs and -unsafe-local-signer are regtest-only.
set -eu

POC="${VAULT_POC_ROOT:-$HOME/tmp/arkade-2fa-pr1}"
if [ ! -f "$POC/poc/2fa-vault/cmd/provider/main.go" ]; then
  echo "Set VAULT_POC_ROOT to an arkade-2fa-vault-poc checkout" >&2
  exit 1
fi

if curl -sf --max-time 1 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  echo "authorizer already running on :8787"
  exit 0
fi

NETWORK="${VAULT_NETWORK:-regtest}"
FIXTURE_OWNER="02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5"
FIXTURE_RECOVERY="0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"
OWNER="${VAULT_EXTERNAL_OWNER_WALLET_PUB:-}"
RECOVERY="${VAULT_RECOVERY_KEY_PUB:-}"

is_fixture_pub() {
  [ "$1" = "$FIXTURE_OWNER" ] || [ "$1" = "$FIXTURE_RECOVERY" ]
}

if [ "$NETWORK" != "regtest" ]; then
  if [ -z "$OWNER" ] || [ -z "$RECOVERY" ]; then
    echo "non-regtest requires VAULT_EXTERNAL_OWNER_WALLET_PUB and VAULT_RECOVERY_KEY_PUB" >&2
    exit 1
  fi
  if is_fixture_pub "$OWNER" || is_fixture_pub "$RECOVERY"; then
    echo "fixture G/2G pubs are not allowed on $NETWORK" >&2
    exit 1
  fi
else
  OWNER="${OWNER:-$FIXTURE_OWNER}"
  RECOVERY="${RECOVERY:-$FIXTURE_RECOVERY}"
fi

VAULT_KEY="${VAULT_VAULT_COSIGNER_PRIV:-$(python3 -c 'import os; print(os.urandom(32).hex())')}"
ARKADE_KEY="${VAULT_ARKADE_PRIV:-$(python3 -c 'import os; print(os.urandom(32).hex())')}"
DB="${VAULT_DB:-$HOME/tmp/vault-authorizer-data/2fa-vault.sqlite}"
mkdir -p "$(dirname "$DB")"

set -- \
  -addr 127.0.0.1:8787 \
  -db "$DB" \
  -vault-cosigner-key "$VAULT_KEY" \
  -arkade-key "$ARKADE_KEY" \
  -external-owner-wallet "$OWNER" \
  -recovery-key "$RECOVERY" \
  -client-origin http://localhost:3003 \
  -rp-id localhost \
  -network "$NETWORK"

if [ "$NETWORK" = "regtest" ]; then
  set -- "$@" -unsafe-local-signer
fi

cd "$POC"
exec go run ./poc/2fa-vault/cmd/provider "$@"

#!/bin/sh
# Local authorizer for vault-mode wallet (http://localhost:3003).
# Requires Go 1.26+ and a checkout of arkade-2fa-vault-poc.
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

OWNER="${VAULT_EXTERNAL_OWNER_WALLET_PUB:-02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5}"
RECOVERY="${VAULT_RECOVERY_KEY_PUB:-0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798}"
VAULT_KEY="${VAULT_VAULT_COSIGNER_PRIV:-$(python3 -c 'import os; print(os.urandom(32).hex())')}"
ARKADE_KEY="${VAULT_ARKADE_PRIV:-$(python3 -c 'import os; print(os.urandom(32).hex())')}"
DB="${VAULT_DB:-$HOME/tmp/vault-authorizer-data/2fa-vault.sqlite}"
mkdir -p "$(dirname "$DB")"

cd "$POC"
exec go run ./poc/2fa-vault/cmd/provider \
  -addr 127.0.0.1:8787 \
  -db "$DB" \
  -unsafe-local-signer \
  -vault-cosigner-key "$VAULT_KEY" \
  -arkade-key "$ARKADE_KEY" \
  -external-owner-wallet "$OWNER" \
  -recovery-key "$RECOVERY" \
  -client-origin http://localhost:3003 \
  -rp-id localhost \
  -network regtest

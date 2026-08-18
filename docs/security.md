# Security

This is a Mutinynet demo. It is not a custody boundary.

## Closed here

| Claim | Status |
| --- | --- |
| Network caller uses a generic Mutinynet signer to skip policy | Closed. Constrained handler + one pinned outbound Arkade call |
| VaultCosigner use is bound to WebAuthn, tx, and budget | Yes, on Routine |
| Browser reconciles the Arkade sighash | Yes, one-input Routine |
| Empty `vaultId` spends the leftover singleton | Closed. Tenant processes require an explicit id |
| Master scalar is the leftover first vault’s on-chain key | New enrolls are HKDF children. Leftover-direct-v0 signing is refused |
| G / 2G as hardware | Rejected |

## Not closed

| Claim | Status |
| --- | --- |
| Host/root cannot take VaultCosigner | No. Process isolation, not an HSM |
| Same-origin XSS is tolerated | No. Unlocked PhoneRoutine / PRF are stealable |
| Always-on watcher for a 6-block hardware hold | Not shipped |
| Mainnet | No |

## Report a hole

See [SECURITY.md](../SECURITY.md).

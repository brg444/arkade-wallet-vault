# Security boundary

The current build is a Mutinynet release candidate with open mainnet release
gates. Real-fund use remains out of scope.

## Enforced invariants

- The wallet rebuilds the enrolled Savings, boarding, and Spending programs
  from pinned public facts and refuses mismatched scripts or addresses.
- A VTXO operation ID is persisted before reservation. The phone authenticates
  its vault, purpose, destination script, and amount before the service may
  reserve an outpoint.
- Transaction authorization is separate from reservation and binds the exact
  Arkade transaction and checkpoint requests.
- Savings ordinary spend requires the phone and an external hardware
  signature. Raw hardware and recovery private keys are not accepted by
  production routes.
- The Vault service holds authoritative allowance state and independently
  validates transactions before adding the VaultCosigner signature.
- Every fresh wallet is bound to the current template, network, Operator, and
  canonical descriptor. Older preview and migration formats are rejected.

## Assumptions and open gates

- Browser code controls a wrapped phone secret after successful local user
  verification. A compromised origin or injected script in that session can
  attack the browser boundary.
- The current VaultCosigner is file-backed, not isolated in attested production
  hardware.
- Boarding temporarily uses a phone-plus-Operator contract before value reaches
  `vault-policy-v1`. Vault policy does not govern that intermediate.
- Browser concurrency depends on Web Locks. Boarding and ordinary sends fail
  closed when that capability is unavailable.
- Candidate arkd and SDK intent-lifecycle changes require upstream releases,
  wallet pins, and Redis-backed qualification. Candidate SDK selection keeps
  nonterminal intent inputs locked and fails closed when durable intent state
  is unreadable. Candidate arkd must restore every pre-`PREPARED` failure
  atomically and complete an exact durable `PREPARED` batch after restart or an
  ambiguous broadcast response.
- Mainnet v1 does not resume a lost MuSig2 signing session. The wallet waits for
  the Operator to restore the exact intent or reconciles the durable batch
  outcome. Seamless continuation requires protected private-nonce persistence
  and exact event replay and remains outside this release.
- The wallet provides a local recovery watcher, not a continuously available
  watchtower.
- External hardware support must be qualified against the custom tapscript PSBT
  before any device is listed for mainnet.

The full release criteria are tracked in
[mainnet-v2-baseline.md](mainnet-v2-baseline.md). Report a suspected security
defect through [the private disclosure process](../SECURITY.md).

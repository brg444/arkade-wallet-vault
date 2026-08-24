# Security boundary

This Mutinynet release candidate has open mainnet release gates. Real-fund use
remains out of scope.

## Enforced invariants

- The wallet rebuilds the enrolled Savings, boarding, and Spending programs
  from pinned public facts and refuses mismatched scripts or addresses.
- A VTXO operation ID is persisted before reservation. The phone authenticates
  its vault, purpose, destination script, and amount before the service may
  reserve an outpoint.
- Transaction authorization is separate from reservation and binds the exact
  Arkade transaction and checkpoint requests.
- Before the first Operator submission, the wallet persists a phone-and-
  VaultCosigner proof for the exact reserved inputs. It submits once. An
  ambiguous response is recovered through the official SDK pending-transaction
  interface, and the returned transaction and checkpoints must match the
  persisted operation exactly.
- Savings ordinary spend requires the phone and an external hardware
  signature. Raw hardware and recovery private keys are not accepted by
  production routes.
- The Vault service holds authoritative allowance state and independently
  validates transactions before adding the VaultCosigner signature.
- Every wallet is bound to the release template, network, Operator, and
  canonical Savings, Spending, and boarding descriptors through the signed
  recovery binding. Any other format is rejected.
- The browser also records a fresh-release local program pin for the vault
  identifier, network, Savings descriptor, and immutable Spending and boarding
  fields. Status drift, record tampering, extra fields, and an enrolled-to-
  unenrolled downgrade fail closed.
- The disabled Lightning send lifecycle uses the published swap repository,
  manager, VHTLC, and refunder. It stores complete recovery state before
  exposing a funding target and binds the refund to the exact
  `vault-policy-v1` script. Funding remains subject to the ordinary VTXO
  authorization policy.

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
- Arkade transaction construction, intent handling, boarding, and settlement
  use the official SDK against `https://arkade.computer`. Vault code does not
  add Operator lifecycle endpoints or replay a lost MuSig2 signing session.
- Boarding attempts are serialized by a per-vault Web Lock. The confirmed
  onchain input is then handed to the official SDK; Vault code does not maintain
  a competing intent lock or registration lifecycle.
- An empty or mismatched pending-transaction lookup stays fail-closed and keeps
  the operation locked. Operator-side manual resolution is an availability
  requirement, not a reason to resubmit an ambiguous transaction.
- The wallet provides a local recovery watcher, not a continuously available
  watchtower.
- External hardware support must be qualified against the custom tapscript PSBT
  before any device is listed for mainnet.
- Lightning send enablement requires an approved signed solver card, quote and
  reservation expiry coordination, and real payment, ambiguous funding, and
  refund tests. Lightning receive also requires a production solver route,
  covenant claim service, reload-safe state, and proof that claims pay the
  exact Spending script.

The full release criteria are tracked in
[mainnet-v2-baseline.md](mainnet-v2-baseline.md). Report a suspected security
defect through [the private disclosure process](../SECURITY.md).

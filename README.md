# Arkade Vault Wallet

> [!WARNING]
> This release candidate runs only on Mutinynet. Real-fund use is out of scope.
> Mainnet activation requires reviewed network, Emulator, and Vault Program
> pins described below.

Arkade Vault Wallet separates funds into two programs:

- Spending holds VTXOs governed by `vault-policy-v1`. The device, Vault
  service, and Arkade Operator collaborate on ordinary sends, while the service
  enforces the rolling allowance.
- Savings is the L1 `arkade-vault/savings-v1` program. Ordinary Savings
  transfers require the device and an external hardware signature. Optional
  recovery can start a delayed path but cannot spend Savings immediately.

Spending receive presents one BIP21 request containing an Arkade address and a
Bitcoin boarding address. Arkade-aware payments arrive as VTXOs. Confirmed
onchain payments enter the vault's enrolled boarding program, then the official
SDK settles them into Spending. Savings-to-Spending uses that same path. The
only supported boarding program is `vault-board-v1`, documented in
[docs/boarding.md](docs/boarding.md).

The browser never receives the VaultCosigner key. Hardware and recovery
private keys are not accepted by production screens; those workflows exchange
PSBTs with an external signer.

Enrollment freezes a protection tier and one fixed `vault-policy-v1` policy
before passkey creation. Standard has no recovery key; Advanced requires one
and exposes only the delayed recovery paths already implemented by the Vault
Program. Spending offers Lower exposure (25,000 sats per payment and 50,000
sats per rolling 24 hours), Everyday (50,000 and 100,000), or custom values for
those two limits. The authenticated fee ceilings remain release-managed at
5,000 sats and 10 sat/vB. The complete descriptor, tier, and canonical policy
digest are pinned locally and in Recovery Kit version 3.

## Components

| Component                                                            | Responsibility                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| This wallet                                                          | Enrollment, transaction construction, device authorization, external PSBT handoff, Operator coordination, and recovery. |
| [Arkade Vault Server](https://github.com/brg444/arkade-vault-server) | Immutable Vault Program records, rolling allowance, VaultCosigner policy, and transaction verification.                 |
| Arkade Operator                                                      | VTXO index, batch coordination, and the release-pinned Operator signatures.                                             |

The browser calls the Vault service and Arkade Operator through same-origin
routes. Enrollment requires an invitation created by the service operator.
See [the documentation index](docs/README.md) for the program and release
boundaries.

VTXO state follows the official Arkade Wallet worker architecture. One scoped
worker owns the official SDK Wallet, Contract Manager, repositories, and a
boarding key provisioned only after the existing PRF unlock succeeds. The page
never receives that key or owns a parallel settlement lifecycle. Exact upstream
revisions and intentional Vault adapters are recorded in
[docs/upstream-alignment.md](docs/upstream-alignment.md).

## Local development

Use Node.js and pnpm:

```bash
pnpm install
pnpm start
```

The development server listens on
[http://localhost:3003](http://localhost:3003).

When the local Vault service has a gateway secret, pass the same value only to
the Vite process:

```bash
VAULT_GATEWAY_SECRET=<local-gateway-secret> pnpm start
```

The development proxy adds the private header to `/v1` requests. Never expose
this value through a `VITE_` variable; variables with that prefix are compiled
into browser code.

Run the release checks with:

```bash
pnpm test:unit
pnpm lint
pnpm format:check
pnpm build
```

## Release status

The application contains only Arkade Vault workflows. Ordinary VTXO Spending
supports fragmented inputs, exact no-change sends, the Operator's bounded
intent fee policy, and recovery after an ambiguous Operator submission through
the official SDK pending-transaction interface. Mainnet remains blocked on
live lifecycle qualification, browser concurrency tests, production key
isolation, and mainnet-specific program pins. The confirmed mainnet Emulator
endpoint advertises the same signer already pinned by the official SDK, but it
has not yet passed Vault release qualification. Vault Program and policy
schema bounds require a separate mainnet release review. A feature-gated
outbound BOLT11 lifecycle delegates RFQ, VHTLC, persistence, restart, and refund
handling to the published swap package, then funds through the ordinary VTXO
send path. The Mutinynet release candidate enables send; mainnet remains
disabled. Its solver, refund, expiry, and live-payment gates are recorded in
[docs/lightning.md](docs/lightning.md). The complete release gate is in
[docs/mainnet-v2-baseline.md](docs/mainnet-v2-baseline.md).

Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

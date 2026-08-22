# Arkade Vault Wallet

> [!WARNING]
> This branch is a Mutinynet release candidate. Mainnet identities, delays,
> fees, hardware integrations, and upstream intent handling remain under
> review. Real-fund use is blocked.

Arkade Vault Wallet separates funds into two programs:

- Spending holds VTXOs governed by `vault-policy-v1`. The device, Vault
  service, and Arkade Operator collaborate on ordinary sends, while the service
  enforces the rolling allowance.
- Savings is the L1 `arkade-vault/savings-v1` program. Ordinary Savings
  transfers require the device and an external hardware signature. Optional
  recovery can start a delayed path but cannot spend Savings immediately.

Spending receive presents one BIP21 request containing an Arkade address and a
Bitcoin boarding address. Arkade-aware payments arrive as VTXOs. Confirmed
onchain payments enter `vault-board-v1`, then the wallet settles them into the
Spending program. Savings-to-Spending uses that same boarding path.

The browser never receives the VaultCosigner key. Hardware and recovery
private keys are not accepted by production screens; those workflows exchange
PSBTs with an external signer.

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

## Local development

Use Node.js and pnpm:

```bash
pnpm install
pnpm start
```

The development server listens on
[http://localhost:3003](http://localhost:3003).

Run the release checks with:

```bash
pnpm test:unit
pnpm lint
pnpm format:check
pnpm build
```

## Mainnet status

This repository no longer carries the inherited general wallet application,
old Vault templates, demo funding, raw private-key screens, or legacy onchain
Spending account. Remaining mainnet gates include ordinary multi-input VTXO
spends, exact-value sends, nonzero Operator fees, the boarding trust window,
durable intent recovery, browser concurrency, production key isolation, and
mainnet-specific program pins. The complete list is in
[docs/mainnet-v2-baseline.md](docs/mainnet-v2-baseline.md).

Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

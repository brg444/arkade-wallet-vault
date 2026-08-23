# Arkade Vault Wallet documentation

| Document                                             | Scope                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| [Architecture](architecture.md)                      | Browser, Vault service, Arkade Operator, persistence, and trust boundaries. |
| [Vault Program](program.md)                          | Savings, Spending, recovery, and the versioned contract.                    |
| [VTXO boarding](boarding.md)                         | Onchain entry into Spending and observed SDK lifecycle constraints.         |
| [Interrupted settlement](resumable-settlement.md)    | Fail-closed intent recovery and the Operator abort-or-complete boundary.     |
| [Mainnet v2 baseline](mainnet-v2-baseline.md)        | Fresh application boundary, release order, and unresolved gates.            |
| [Security](security.md)                              | Current guarantees, assumptions, and excluded claims.                       |
| [Dependency advisories](advisories.md)               | Production audit findings and bundle status.                                |
| [Contract Pack](../src/lib/vault/contract-pack.json) | Machine-readable programs shared byte-for-byte with the server.             |

Service persistence, API, and deployment operations are documented in
[Arkade Vault Server](https://github.com/brg444/arkade-vault-server).

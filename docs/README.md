# Vaulted documentation

| Document                                             | Scope                                                                         |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Architecture](architecture.md)                      | Browser, Vault service, Arkade Operator, persistence, and trust boundaries.   |
| [Vault Program](program.md)                          | Savings, Spending, recovery, and the versioned contract.                      |
| [VTXO boarding](boarding.md)                         | Worker-owned SDK settlement into the Spending program.                        |
| [Upstream alignment](upstream-alignment.md)          | Official Wallet and SDK pins, Vault extensions, and dependency update checks. |
| [Release qualification](testing.md)                  | Automated, physical Face ID, and live Mutinynet release gates.                |
| [Lightning send](lightning.md)                       | Package-native outbound BOLT11 boundary, refunds, and enablement gates.       |
| [Mainnet v2 baseline](mainnet-v2-baseline.md)        | Fresh application boundary, release order, and unresolved gates.              |
| [Security](security.md)                              | Current guarantees, assumptions, and excluded claims.                         |
| [Dependency advisories](advisories.md)               | Production audit findings and bundle status.                                  |
| [Contract Pack](../src/lib/vault/contract-pack.json) | Machine-readable programs shared byte-for-byte with the server.               |

Service persistence, API, and deployment operations are documented in
[Arkade Vault Server](https://github.com/brg444/arkade-vault-server).

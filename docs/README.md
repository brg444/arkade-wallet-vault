# Vault documentation

Start here. One current spec. Leftover v4 vs new v5 is labeled. Handoffs
and audits are not the spec.

| Read | What it is |
| --- | --- |
| [plan.md](plan.md) | Now / next / later, packaging |
| [live.md](live.md) | **Funded today:** v4 on Mutinynet |
| [v5-overview.md](v5-overview.md) | **Next product:** staged recovery |
| [v5-transactions.md](v5-transactions.md) | Trees and each transaction |
| [v5-api.md](v5-api.md) | HTTP, route table, kit CLI |
| [v5-recovery-kit.md](v5-recovery-kit.md) | Operate a hold offline |

Code: `src/lib/vault/v5/` (client). The live authorizer still mints v4.

## Not the spec

| File | What it is |
| --- | --- |
| [archive/](archive/) | Custos notes, session handoff |
| [swaps.regtest.md](swaps.regtest.md) | Upstream VTXO harness |

Do not mint v4 after the authorizer cuts over. Do not read a v3 writeup as
current.

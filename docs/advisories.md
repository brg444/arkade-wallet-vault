# Production dependency advisories

The August 22, 2026 `pnpm audit --prod` run reports two advisories in the
`@arkade-os/sdk@0.4.65 -> ws-electrumx-client -> ws@8.18.3` path:

| Severity | Advisory                                 | Fixed version |
| -------- | ---------------------------------------- | ------------- |
| Moderate | `CVE-2026-45736` / `GHSA-58qx-3vcg-4xpx` | `ws` 8.20.1   |
| High     | `CVE-2026-48779` / `GHSA-96hv-2xvq-fx4p` | `ws` 8.21.0   |

The Vault application imports the Arkade SDK for VTXO boarding, index access,
and Operator coordination, so this dependency is part of the production graph.
The release must update the transitive `ws` version through a reviewed SDK or
dependency update. An unqualified package-manager override is insufficient
because it can change transport behavior outside the SDK's tested dependency
set.

The production build emits a 1,450.40 kB main JavaScript chunk and
Vite's chunk-size advisory, leaving a performance and supply-chain review item.
Bundle inspection must confirm that the graph contains only Vault workflows
and excludes test-only secret helpers.

Run and record both checks for each release candidate:

```bash
pnpm audit --prod
pnpm build
```

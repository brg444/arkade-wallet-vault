# Production dependency advisories

The August 23, 2026 audit found two advisories in the
`@arkade-os/sdk@0.4.65 -> ws-electrumx-client -> ws@8.18.3` path:

| Severity | Advisory                                 | Fixed version |
| -------- | ---------------------------------------- | ------------- |
| Moderate | `CVE-2026-45736` / `GHSA-58qx-3vcg-4xpx` | `ws` 8.20.1   |
| High     | `CVE-2026-48779` / `GHSA-96hv-2xvq-fx4p` | `ws` 8.21.0   |

The Vault application imports the Arkade SDK for VTXO boarding, index access,
and Operator coordination, so this dependency is part of the production graph.
The release pins `ws@8.21.0` through a package-manager override. The direct
consumer declares `^8.12.1`, its isomorphic peer accepts the same major, all
wallet tests and the production build pass, and `pnpm audit --prod` reports no
known vulnerabilities. Remove the override after an official SDK release
resolves to `ws@8.21.0` or later and passes the same checks.

The production build emits an approximately 1.47 MB main JavaScript chunk and
Vite's chunk-size advisory, leaving a performance and supply-chain review item.
Bundle inspection must confirm that the graph contains only Vault workflows
and excludes test-only secret helpers.

Run and record both checks for each release candidate:

```bash
pnpm audit --prod
pnpm build
```

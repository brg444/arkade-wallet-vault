# Production dependency advisories

`pnpm audit --prod` after the vault split.

## Resolved

Direct `dompurify` is at `^3.4.14`. Vault mode does not import it.

## Remaining: `ws` via `@arkade-os/sdk`

`@arkade-os/sdk` 0.4.28 depends on `ws-electrumx-client`, which pulls `ws`.

Advisories: GHSA for uninitialized memory disclosure (moderate) and fragment memory exhaustion (high).

Vault mode does not import the Arkade SDK, Electrum, Nostr, or swaps. Those sockets are not opened from `vault-index.tsx`.

A jump to SDK 0.4.64 is not a reviewed compatible update for this wallet. No `pnpm.overrides` entry is used, because that would change SDK socket behavior without a review.

The wallet build still vendors `ws` for Electrum. Treat that as an upstream follow-up.

## Vault bundle size

Last mixed entry (Vercel `hc0bwqol1`, vault mode still statically imported the wallet tree):

- JS `1,154.91 kB` (`382.84 kB` gzip)
- CSS `191.32 kB` (`30.40 kB` gzip)

Dedicated `vault.html` / `vault-index.tsx`:

- JS `1,098.88 kB` (`363.00 kB` gzip)
- CSS `181.36 kB` (`29.15 kB` gzip)

HTML has no inline scripts, so vault CSP `script-src` is `'self'` only.

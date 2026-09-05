import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

// Exercise both real Vite entrypoints: static config assertions missed the RC regression.
for (const config of ['vite.config.ts', 'vite.worker.config.ts']) {
  for (const [label, network, gateway, vercel, expected] of [
    ['missing', '', '', '', /Explicit Vault release network required/],
    ['unsupported', 'testnet', '', '', /unsupported Vault network/],
    ['gateway mismatch', 'mutinynet', 'mainnet', '', /networks disagree/],
    ['wrong canonical config', 'mainnet', 'mainnet', '1', /Canonical vercel.json/],
  ]) {
    const result = spawnSync('pnpm', ['exec', 'vite', 'build', '-c', config], {
      encoding: 'utf8',
      env: { ...process.env, VITE_VAULT_RELEASE_NETWORK: network, VAULT_RELEASE_NETWORK: gateway, VERCEL: vercel },
    })
    assert.notEqual(result.status, 0, `${config} accepted ${label}`)
    assert.match(result.stdout + result.stderr, expected)
    console.log(`${config}: rejected ${label}`)
  }
}

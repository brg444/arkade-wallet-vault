import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadEnv, type Plugin } from 'vite'
import { configuredReleaseNetwork } from '../src/lib/vault/network'

// Both the app and worker must select a network before compiling policy code.
export function releaseBuild(emitManifest = false): Plugin {
  let network: string | undefined
  return {
    name: 'vault-release-network',
    config(_config, { command, mode }) {
      if (command !== 'build') return
      const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
      network = configuredReleaseNetwork(env.VITE_VAULT_RELEASE_NETWORK, true)
      if (env.VAULT_RELEASE_NETWORK && env.VAULT_RELEASE_NETWORK !== network) {
        throw new Error('Browser and gateway release networks disagree')
      }
      if (env.VERCEL) {
        if (!env.VAULT_RELEASE_NETWORK) throw new Error('Vercel requires VAULT_RELEASE_NETWORK')
        const config = JSON.parse(readFileSync('vercel.json', 'utf8'))
        if (
          config.buildCommand !== `pnpm build:${network}` ||
          (config.env?.VAULT_RELEASE_NETWORK && config.env.VAULT_RELEASE_NETWORK !== network)
        ) {
          throw new Error('Canonical vercel.json does not match the release network')
        }
      }
      return { define: { 'import.meta.env.VITE_VAULT_RELEASE_NETWORK': JSON.stringify(network) } }
    },
    generateBundle() {
      if (!emitManifest || !network) return
      const worker = readFileSync('public/vault-wallet-service-worker.mjs')
      this.emitFile({
        type: 'asset',
        fileName: 'release.json',
        source: JSON.stringify({ network, workerSha256: createHash('sha256').update(worker).digest('hex') }),
      })
    },
  }
}

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

export const VAULT_WORKER_BUILD_CONTROL = '/__vault_e2e_worker_build'

/** Serves two byte-distinct builds at the production worker URL for update tests. */
export function vaultWorkerBuildFixture(): Plugin {
  const workerPath = resolve(process.cwd(), 'public/vault-wallet-service-worker.mjs')
  let selected: 'a' | 'b' = 'a'

  return {
    name: 'vault-e2e-worker-builds',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      const workerA = readFileSync(workerPath)
      const workers = {
        a: workerA,
        b: Buffer.concat([workerA, Buffer.from('\n// vault-e2e-worker-build-b\n')]),
      }
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url || '/', 'http://localhost')
        if (url.pathname === VAULT_WORKER_BUILD_CONTROL) {
          const version = url.searchParams.get('version')
          if (request.method !== 'POST' || (version !== 'a' && version !== 'b')) {
            response.writeHead(400, { 'Content-Type': 'text/plain' })
            response.end('expected POST with version=a or version=b')
            return
          }
          selected = version
          response.writeHead(204, { 'Cache-Control': 'no-store' })
          response.end()
          return
        }
        if (url.pathname !== '/vault-wallet-service-worker.mjs') {
          next()
          return
        }

        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/javascript; charset=utf-8',
          'Service-Worker-Allowed': '/',
        })
        response.end(workers[selected])
      })
    },
  }
}

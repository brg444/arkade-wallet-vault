import path from 'path'
import { execSync } from 'child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import eslint from 'vite-plugin-eslint'
import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import type { ProxyOptions } from 'vite'

function gitCommitShort(): string {
  if (process.env.VITE_GIT_COMMIT) return process.env.VITE_GIT_COMMIT
  try {
    return execSync('git rev-parse --short=8 HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function vaultE2eOperatorOrigin(): string {
  if (process.env.VAULT_E2E_BUILD !== 'arkade-vault-e2e-only') return ''
  return process.env.VAULT_E2E_OPERATOR_ORIGIN?.trim() || ''
}

function vaultAuthorizerProxy(): ProxyOptions {
  const gatewaySecret = process.env.VAULT_GATEWAY_SECRET?.trim()
  const testTarget = process.env.VAULT_E2E_AUTHORIZER_PROXY_TARGET?.trim()
  return {
    target: testTarget || 'http://127.0.0.1:8787',
    ...(testTarget ? { secure: false } : {}),
    ...(gatewaySecret ? { headers: { 'X-Vault-Gateway-Secret': gatewaySecret } } : {}),
    configure(proxy) {
      proxy.on('error', (_err, _req, res) => {
        const socket = res as {
          writeHead?: (code: number, headers: Record<string, string>) => void
          end?: (body: string) => void
        }
        if (typeof socket.writeHead === 'function' && typeof socket.end === 'function') {
          socket.writeHead(503, { 'Content-Type': 'application/json' })
          socket.end(JSON.stringify({ error: 'vault service is not running' }))
        }
      })
    },
  }
}

function esploraProxy(): ProxyOptions {
  const testTarget = process.env.VAULT_E2E_ESPLORA_PROXY_TARGET?.trim()
  const releaseTarget =
    process.env.VITE_VAULT_RELEASE_NETWORK === 'mainnet'
      ? 'https://mempool.space'
      : 'https://mempool.mutinynet.arkade.sh'
  return {
    target: testTarget || releaseTarget,
    changeOrigin: true,
    ...(testTarget ? { secure: false } : {}),
    rewrite: (path) => path.replace(/^\/esplora/, '/api'),
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    !process.env.VERCEL &&
      eslint({
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: ['src/test/**/*.ts', 'src/test/**/*.tsx', 'src/lib/vault/ceremony/**'],
        cache: false,
      }),
    process.env.HTTPS === 'true' && basicSsl(),
  ].filter(Boolean),
  server: {
    port: 3003,
    host: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/v1': vaultAuthorizerProxy(),
      '/health': vaultAuthorizerProxy(),
      '/esplora': esploraProxy(),
    },
  },
  define: {
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(gitCommitShort()),
    __VAULT_E2E_OPERATOR_ORIGIN__: JSON.stringify(vaultE2eOperatorOrigin()),
  },
  build: {
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      external: ['fs'],
    },
  },
  worker: {
    format: 'es',
  },
})

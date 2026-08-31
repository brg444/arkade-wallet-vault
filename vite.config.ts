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

function vaultAuthorizerProxy(): ProxyOptions {
  const gatewaySecret = process.env.VAULT_GATEWAY_SECRET?.trim()
  return {
    target: 'http://127.0.0.1:8787',
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
      '/esplora': {
        target: 'https://mempool.mutinynet.arkade.sh',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/esplora/, '/api'),
      },
      '/arkade': {
        target: 'https://mutinynet.arkade.sh',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/arkade/, ''),
      },
    },
  },
  define: {
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(gitCommitShort()),
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

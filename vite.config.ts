import path from 'path'
import { execSync } from 'child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import eslint from 'vite-plugin-eslint'
import basicSsl from '@vitejs/plugin-basic-ssl'
import tailwindcss from '@tailwindcss/vite'
import basicAuth from './plugins/vite-plugin-basic-auth'
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
  return {
    target: 'http://127.0.0.1:8787',
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
    basicAuth(),
    process.env.VITE_VAULT_MODE === '1' && {
      name: 'vault-dev-index',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/' || req.url === '/index.html') req.url = '/vault.html'
          next()
        })
      },
    },
    process.env.VITE_VAULT_MODE === '1' && {
      name: 'vault-html-identity',
      transformIndexHtml(html: string) {
        return html
          .replaceAll('Arkade Wallet', 'Arkade Vault')
          .replaceAll('https://arkade.money', 'https://arkade-vault-demo.vercel.app')
          .replaceAll('arkade.money', 'arkade-vault-demo.vercel.app')
          .replace(
            'Your Bitcoin, supercharged. Send payments, swap assets, and lend without giving up your keys.',
            'Mutinynet spending vault. Do not send real bitcoin.',
          )
          .replace(
            '<script defer data-domain="arkade-vault-demo.vercel.app" src="https://plausible.io/js/script.js"></script>',
            '',
          )
      },
    },
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
    port: 3002,
    host: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy:
      process.env.VITE_VAULT_MODE === '1'
        ? {
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
          }
        : undefined,
  },
  define: {
    'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(gitCommitShort()),
  },
  build: {
    emptyOutDir: true,
    sourcemap: process.env.VITE_VAULT_MODE !== '1',
    rollupOptions: {
      external: ['fs'],
      input: process.env.VITE_VAULT_MODE === '1' ? path.resolve(__dirname, 'vault.html') : undefined,
    },
  },
  worker: {
    format: 'es',
  },
})

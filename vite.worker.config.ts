import { releaseBuild } from './scripts/release-build'
import { resolve } from 'path'
import { defineConfig } from 'vite'

function vaultE2eOperatorOrigin(): string {
  if (process.env.VAULT_E2E_BUILD !== 'arkade-vault-e2e-only') return ''
  return process.env.VAULT_E2E_OPERATOR_ORIGIN?.trim() || ''
}

export default defineConfig({
  plugins: [releaseBuild()],
  define: {
    __VAULT_E2E_OPERATOR_ORIGIN__: JSON.stringify(vaultE2eOperatorOrigin()),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/vault-wallet-service-worker.ts'),
      formats: ['es'],
      fileName: 'vault-wallet-service-worker',
    },
    outDir: 'public',
    emptyOutDir: false,
    rollupOptions: {
      external: ['fs'],
      output: { inlineDynamicImports: true },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: { include: ['@arkade-os/sdk'] },
})

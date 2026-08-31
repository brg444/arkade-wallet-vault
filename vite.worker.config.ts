import { resolve } from 'path'
import { defineConfig } from 'vite'

// Mirrors arkade-os/wallet's SDK worker build: one fully bundled file in public
// so the browser can use the default classic registration mode.
export default defineConfig({
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

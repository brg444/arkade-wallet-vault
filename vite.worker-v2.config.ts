import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/vault-wallet-v2-service-worker.ts'),
      formats: ['es'],
      fileName: 'vault-wallet-v2-service-worker',
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

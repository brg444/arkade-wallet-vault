import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  define: {
    __VAULT_E2E_OPERATOR_ORIGIN__: JSON.stringify(''),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    testTimeout: 15000,
    exclude: ['**/e2e/**', '**/e2e-vault/**', '**/node_modules/**', '**/tools/**'],
  },
})

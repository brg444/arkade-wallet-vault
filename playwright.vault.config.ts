import { defineConfig, devices } from '@playwright/test'

const appPort = Number(process.env.VAULT_E2E_PORT || 3003)
const operatorPort = Number(process.env.VAULT_E2E_OPERATOR_PORT || 18_888)
const appOrigin = `http://localhost:${appPort}`
const operatorOrigin = `http://127.0.0.1:${operatorPort}`

export default defineConfig({
  testDir: './src/test/e2e-vault',
  globalSetup: './src/test/e2e-vault/globalSetup.ts',
  timeout: 60000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: appOrigin,
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: 'on-first-retry',
    actionTimeout: 20000,
    navigationTimeout: 30000,
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: `export NODE_ENV=production VAULT_E2E_BUILD=arkade-vault-e2e-only VAULT_E2E_OPERATOR_ORIGIN=${operatorOrigin} VAULT_E2E_AUTHORIZER_PROXY_TARGET=${operatorOrigin} VAULT_E2E_ESPLORA_PROXY_TARGET=${operatorOrigin}; pnpm build:worker && pnpm exec vite --port ${appPort} --host localhost`,
    port: appPort,
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'Mobile Safari service-worker smoke',
      testMatch: '**/vtxo-worker.test.ts',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'Desktop Chromium accessibility and visual',
      grep: /@polish/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
})

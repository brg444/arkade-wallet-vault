import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './src/test/e2e-vault',
  timeout: 60000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3003',
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: 'on-first-retry',
    actionTimeout: 20000,
    navigationTimeout: 30000,
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: 'pnpm start:vault',
    port: 3003,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  projects: [
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 7'] },
    },
  ],
})

import { defineConfig, devices } from '@playwright/test'
import base from './playwright.vault.config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  ...base,
  testMatch: ['**/vault-ui.test.ts', '**/haptics.test.ts'],
  grep: /@interaction|iOS haptics/,
  outputDir: join(tmpdir(), 'vaulted-interaction-results'),
  timeout: 120000,
  use: { ...base.use, video: 'on', trace: 'retain-on-failure' },
  projects: [
    { name: 'Interaction mobile Chromium', use: { ...devices['Pixel 7'] } },
    { name: 'Interaction mobile WebKit', use: { ...devices['iPhone 13'] } },
    { name: 'Interaction desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
  ],
})

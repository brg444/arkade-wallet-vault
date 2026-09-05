import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import base from './playwright.vault.config'

export default defineConfig({
  ...base,
  testDir: './.vault-visual-tests',
  globalSetup: './.vault-visual-tests/globalSetup.mjs',
  testMatch: '**/*.pw.mjs',
  respectGitIgnore: false,
  grep: /@visual-refinement/,
  outputDir: join(tmpdir(), 'vaulted-visual-refinement-results'),
  timeout: 120000,
  projects: [
    { name: 'narrow', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 568 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
})

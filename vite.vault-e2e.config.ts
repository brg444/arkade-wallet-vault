import { defineConfig, mergeConfig } from 'vite'
import baseConfig from './vite.config'
import { vaultWorkerBuildFixture } from './src/test/e2e-vault/fixtures/vaultWorkerBuilds'

export default defineConfig(mergeConfig(baseConfig, { plugins: [vaultWorkerBuildFixture()] }))

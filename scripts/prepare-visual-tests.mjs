import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// These Node-side fixtures import wallet modules containing Vite's import.meta.env.
// Bundle only the test harness; the browser still loads the real application through Vite.
const require = createRequire(import.meta.url)
const viteRequire = createRequire(require.resolve('vite/package.json'))
const { build } = viteRequire('esbuild')
for (const name of ['globalSetup', 'vault-ui.test', 'haptics.test', 'guidance.test', 'polish.test']) {
  await build({
    entryPoints: [resolve(`src/test/e2e-vault/${name}.ts`)],
    outfile: resolve(`.vault-visual-tests/${name.replace(/\.test$/, '.pw')}.mjs`),
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    define: { 'import.meta.env': '{}' },
  })
}

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const BROWSER_FIXTURE = '/src/test/e2e-vault/fixtures/vtxo-browser.ts'

async function registerWorker(page: Page, vaultId: string) {
  return page.evaluate(
    async ({ fixturePath, id }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      return fixture.registerWalletWorker(id)
    },
    { fixturePath: BROWSER_FIXTURE, id: vaultId },
  )
}

async function clearVaultWorkers(context: BrowserContext) {
  for (const page of context.pages()) {
    await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(
        registrations.filter((item) => item.scope.includes('/__vault-wallet/')).map((item) => item.unregister()),
      )
    })
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test.afterEach(async ({ context }) => {
  await clearVaultWorkers(context)
})

test('keeps A → B → A vaults on isolated persistent workers', async ({ page }) => {
  const firstA = await registerWorker(page, 'vault-a')
  const b = await registerWorker(page, 'vault-b')
  const secondA = await registerWorker(page, 'vault-a')

  expect(firstA.state).toBe('activated')
  expect(b.state).toBe('activated')
  expect(secondA.state).toBe('activated')
  expect(firstA.scope).toBe(secondA.scope)
  expect(firstA.scope).not.toBe(b.scope)
  expect(firstA.activeScriptUrl).toContain('vault-wallet-service-worker.mjs?vault=')
  expect(secondA.registrationCount).toBe(2)
})

test('keeps simultaneous A/B tabs on different workers and scopes', async ({ context, page }) => {
  const pageB = await context.newPage()
  await pageB.goto('/')

  const [a, b] = await Promise.all([registerWorker(page, 'vault-a'), registerWorker(pageB, 'vault-b')])

  expect(a.state).toBe('activated')
  expect(b.state).toBe('activated')
  expect(a.scope).not.toBe(b.scope)
  expect(a.activeScriptUrl).not.toBe(b.activeScriptUrl)
})

test('retains the scoped worker across an offline interval and reload', async ({ context, page }) => {
  const before = await registerWorker(page, 'vault-offline')
  await context.setOffline(true)
  const offline = await page.evaluate(
    async ({ fixturePath, id }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      return fixture.walletWorkerState(id)
    },
    { fixturePath: BROWSER_FIXTURE, id: 'vault-offline' },
  )
  expect(offline).toEqual({ scope: before.scope, state: 'activated' })

  await context.setOffline(false)
  await page.reload()
  const reconnected = await registerWorker(page, 'vault-offline')
  expect(reconnected.scope).toBe(before.scope)
  expect(reconnected.state).toBe('activated')
})

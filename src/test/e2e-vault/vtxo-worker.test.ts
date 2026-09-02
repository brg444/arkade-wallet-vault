import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import type { VaultStatus } from '../../lib/vault/types'
import { vaultWalletDatabase, vaultWalletWorkerScope } from '../../lib/vault/vtxo/walletWorkerNames'

const BROWSER_FIXTURE = '/src/test/e2e-vault/fixtures/vtxo-browser.ts'
const UI_FIXTURE = '/src/test/e2e-vault/fixtures/vault-ui.ts'
const FIXTURE_CONTROL = 'http://127.0.0.1:18888'
const WORKER_BUILD_CONTROL = '/__vault_e2e_worker_build'
const WORKER_HARNESS = '/src/test/e2e-vault/fixtures/worker-harness.html'

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

async function postFixture(page: Page, path: string, body: unknown) {
  const response = await page.request.post(`${FIXTURE_CONTROL}${path}`, { data: body })
  expect(response.ok()).toBe(true)
}

async function selectWorkerBuild(page: Page, version: 'a' | 'b') {
  const response = await page.request.post(`${WORKER_BUILD_CONTROL}?version=${version}`)
  expect(response.status()).toBe(204)
}

test.beforeEach(async ({ page }) => {
  await selectWorkerBuild(page, 'a')
  await page.goto(WORKER_HARNESS)
})

test.afterEach(async ({ context, page }) => {
  await clearVaultWorkers(context)
  await selectWorkerBuild(page, 'a')
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
  await pageB.goto(WORKER_HARNESS)

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

test('preserves SDK wallet identity across worker restart and cross-build activation', async ({
  browserName,
  context,
  page,
}) => {
  const installedStatus = (await page.evaluate(
    async (path) => (await import(/* @vite-ignore */ path)).vaultUiStatus(),
    UI_FIXTURE,
  )) as VaultStatus
  await postFixture(page, '/__vault_e2e_authorizer', installedStatus)
  await postFixture(page, '/__vault_e2e_esplora', {
    boardingAddress: installedStatus.vtxoBoardingAddress,
    boardingUtxos: [],
    savingsAddress: installedStatus.savingsAddress,
    savingsTxs: [],
    savingsUtxos: [],
  })
  await postFixture(page, '/__vault_e2e_operator', { available: true, vtxos: [] })

  const marker = 'worker-restart-repository-marker'
  const snapshot = (repositoryMarker?: string) =>
    page.evaluate(
      async ({ currentStatus, fixturePath, markerValue }) => {
        const fixture = await import(/* @vite-ignore */ fixturePath)
        return fixture.walletRuntimeSnapshot(currentStatus, markerValue)
      },
      {
        currentStatus: installedStatus,
        fixturePath: BROWSER_FIXTURE,
        markerValue: repositoryMarker,
      },
    )

  const before = await snapshot(marker)
  expect(before).toEqual({
    address: installedStatus.vtxoBoardingAddress,
    database: vaultWalletDatabase(installedStatus.vaultId),
    marker,
    scope: new URL(vaultWalletWorkerScope(installedStatus.vaultId), page.url()).href,
    state: 'activated',
  })

  if (browserName === 'chromium') {
    const cdp = await context.newCDPSession(page)
    await cdp.send('ServiceWorker.enable')
    await cdp.send('ServiceWorker.stopAllWorkers')
    await page.reload()
    expect(await snapshot()).toEqual(before)
  }

  await selectWorkerBuild(page, 'b')
  const replacement = await page.evaluate(async (scope) => {
    const registration = await navigator.serviceWorker.getRegistration(scope)
    if (!registration?.active) throw new Error('Active Vault wallet worker missing')
    const previous = registration.active
    const activated = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Replacement worker did not activate')), 15_000)
      registration.addEventListener(
        'updatefound',
        () => {
          const installing = registration.installing
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'activated') {
              window.clearTimeout(timeout)
              resolve()
            } else if (installing.state === 'redundant') {
              window.clearTimeout(timeout)
              reject(new Error('Replacement worker became redundant'))
            }
          })
        },
        { once: true },
      )
    })
    await registration.update()
    await activated
    return {
      changed: registration.active !== previous,
      previousState: previous.state,
      state: registration.active?.state,
    }
  }, before.scope)
  expect(replacement).toEqual({ changed: true, previousState: 'redundant', state: 'activated' })

  await page.reload()
  expect(await snapshot()).toEqual(before)
})

import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const BROWSER_FIXTURE = '/src/test/e2e-vault/fixtures/vtxo-browser.ts'
const BOARDING_ADDRESS = 'tb1pboardingfixture'
const BOARDING_TXID = '11'.repeat(32)

async function registerWorker(page: Page, vaultId: string) {
  return page.evaluate(
    async ({ fixturePath, id }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      return fixture.registerReadonlyWorker(id)
    },
    { fixturePath: BROWSER_FIXTURE, id: vaultId },
  )
}

async function seedIntent(page: Page, vaultId: string, state: string, commitmentTransactionId?: string) {
  const seed = () =>
    page.evaluate(
      async ({ fixturePath, input }) => {
        const fixture = await import(/* @vite-ignore */ fixturePath)
        await fixture.seedBoardingIntent(input)
      },
      { fixturePath: BROWSER_FIXTURE, input: { vaultId, state, commitmentTransactionId } },
    )
  try {
    await seed()
  } catch (error) {
    if (!/execution context was destroyed/i.test(String(error))) throw error
    await page.waitForLoadState('domcontentloaded')
    await seed()
  }
}

async function intentState(page: Page, vaultId: string, now?: number, commitments: string[] = []) {
  return page.evaluate(
    async ({ fixturePath, id, at, destinationCommitments }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      return fixture.boardingIntentState(id, at, destinationCommitments)
    },
    { fixturePath: BROWSER_FIXTURE, id: vaultId, at: now, destinationCommitments: commitments },
  )
}

async function boardingSnapshot(page: Page, vaultId: string) {
  return page.evaluate(
    async ({ fixturePath, id, address }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      return fixture.boardingSnapshot(id, address)
    },
    { fixturePath: BROWSER_FIXTURE, id: vaultId, address: BOARDING_ADDRESS },
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

test('activates classic workers in isolated A → B → A vault scopes', async ({ page }) => {
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
  const registrationCount = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations()
    return registrations.filter((item) => item.scope.includes('/__vault-wallet/')).length
  })
  expect(registrationCount).toBe(2)
})

test('retains the scoped worker across an offline interval and reloads it after reconnect', async ({
  context,
  page,
}) => {
  await seedIntent(page, 'vault-offline', 'waiting_for_batch')
  const before = await registerWorker(page, 'vault-offline')
  await context.setOffline(true)
  const offline = await page.evaluate(
    async ({ fixturePath, id }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      return fixture.readonlyWorkerState(id)
    },
    { fixturePath: BROWSER_FIXTURE, id: 'vault-offline' },
  )
  expect(offline).toEqual({ scope: before.scope, state: 'activated' })

  await context.setOffline(false)
  await page.reload()
  const reconnected = await registerWorker(page, 'vault-offline')
  expect(reconnected.scope).toBe(before.scope)
  expect(reconnected.state).toBe('activated')
  await expect(intentState(page, 'vault-offline')).resolves.toBe('active')
})

test('reconciles every interrupted nonterminal intent from IndexedDB after reload', async ({ page }) => {
  for (const state of ['waiting_to_submit', 'waiting_for_batch', 'batch_in_progress']) {
    const vaultId = `vault-${state}`
    await seedIntent(page, vaultId, state)
    await page.reload()
    await expect(intentState(page, vaultId)).resolves.toBe('active')
  }

  const staleVault = 'vault-stale-page'
  await seedIntent(page, staleVault, 'waiting_for_batch')
  await expect(intentState(page, staleVault, Date.now() + 5 * 60_000 + 1)).resolves.toBe('none')

  const destinationVault = 'vault-destination-evidence'
  await seedIntent(page, destinationVault, 'batch_in_progress', 'commitment-destination')
  await page.reload()
  await expect(intentState(page, destinationVault, undefined, ['commitment-destination'])).resolves.toBe('settled')
})

test('moves pending boarding value to confirmed VTXO value without a double-count window', async ({ page }) => {
  let confirmed = false
  await page.route('**/esplora/address/**/utxo', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          txid: BOARDING_TXID,
          vout: 0,
          value: 50_000,
          status: { confirmed },
        },
      ]),
    })
  })

  const vaultId = 'vault-propagation-order'
  const pending = await boardingSnapshot(page, vaultId)
  expect(pending).toMatchObject({ total: 50_000, confirmed: 0, unconfirmed: 50_000 })
  expect(pending.history).toEqual([expect.objectContaining({ activity: 'boarding', confirmed: false })])

  confirmed = true
  const onchainConfirmed = await boardingSnapshot(page, vaultId)
  expect(onchainConfirmed).toMatchObject({ total: 50_000, confirmed: 50_000, unconfirmed: 0 })

  await seedIntent(page, vaultId, 'batch_succeeded', 'commitment-vtxo')
  await page.reload()
  const [laggingOnchain, vtxo] = await Promise.all([
    boardingSnapshot(page, vaultId),
    page.evaluate(
      async ({ fixturePath, amount, commitment }) => {
        const fixture = await import(/* @vite-ignore */ fixturePath)
        return fixture.issuedVtxoSnapshot(amount, commitment)
      },
      { fixturePath: BROWSER_FIXTURE, amount: 49_000, commitment: 'commitment-vtxo' },
    ),
  ])

  expect(laggingOnchain.total).toBe(0)
  expect(vtxo.balance + laggingOnchain.total).toBe(49_000)
  expect(vtxo.history).toEqual([expect.objectContaining({ amount: 49_000, confirmed: true, type: 'received' })])
})

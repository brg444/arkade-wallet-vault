import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { decodeVaultBip21 } from '../../lib/vault/bip21'
import { POLICY_VERSION } from '../../lib/vault/constants'
import { SAVINGS_TEMPLATE } from '../../lib/vault/program/constants'
import type { VaultStatus } from '../../lib/vault/types'

const UI_FIXTURE = '/src/test/e2e-vault/fixtures/vault-ui.ts'
const WORKER_FIXTURE = '/src/test/e2e-vault/fixtures/vtxo-browser.ts'
const OPERATOR_CONTROL = 'http://127.0.0.1:18888/__vault_e2e_operator'
const BOARDING_TXID = '11'.repeat(32)
const VTXO_TXID = 'aa'.repeat(32)
const COMMITMENT_TXID = 'cc'.repeat(32)

type EsploraUtxo = {
  txid: string
  vout: number
  value: number
  status: { confirmed: boolean; block_height?: number }
}

type EsploraTx = {
  txid: string
  vin: { prevout?: { scriptpubkey_address?: string; value?: number } }[]
  vout: { scriptpubkey_address?: string; value?: number }[]
  status: { confirmed: boolean; block_height?: number; block_time?: number }
}

type VaultUiState = {
  boardingUtxos: EsploraUtxo[]
  savingsTxs: EsploraTx[]
  savingsUtxos: EsploraUtxo[]
}

type OperatorFixtureState = {
  available?: boolean
  requests?: string[]
  vtxos?: Record<string, unknown>[]
}

type OpenVaultOptions = {
  beforeReload?: (page: Page, status: VaultStatus) => Promise<void>
  operatorAvailable?: boolean
  operatorVtxos?: Record<string, unknown>[]
  waitForBalance?: boolean
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function setOperatorState(input: OperatorFixtureState = {}) {
  const response = await fetch(OPERATOR_CONTROL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw new Error(`Operator fixture reset failed: ${response.status}`)
}

async function setOperatorVtxos(vtxos: Record<string, unknown>[] = []) {
  await setOperatorState({ available: true, vtxos })
}

async function readOperatorState(): Promise<Required<OperatorFixtureState>> {
  const response = await fetch(OPERATOR_CONTROL)
  if (!response.ok) throw new Error(`Operator fixture read failed: ${response.status}`)
  return response.json() as Promise<Required<OperatorFixtureState>>
}

async function wireVtxo(page: Page, status: VaultStatus, input: Record<string, unknown>) {
  return page.evaluate(
    async ({ fixturePath, currentStatus, currentInput }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      return fixture.wireVaultVtxo(currentStatus, currentInput)
    },
    { fixturePath: UI_FIXTURE, currentStatus: status, currentInput: input },
  ) as Promise<Record<string, unknown>>
}

async function seedIntent(page: Page, state: string, commitmentTransactionId?: string) {
  await page.evaluate(
    async ({ fixturePath, input }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      await fixture.seedBoardingIntent(input)
    },
    {
      fixturePath: WORKER_FIXTURE,
      input: { vaultId: 'e2e-vault-ui', state, commitmentTransactionId },
    },
  )
}

async function dispatchUtxoUpdate(page: Page, vaultId: string) {
  await page.evaluate(
    async ({ fixturePath, id }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      fixture.dispatchReadonlyUtxoUpdate(id)
    },
    { fixturePath: WORKER_FIXTURE, id: vaultId },
  )
}

async function seedReviewedSpend(
  page: Page,
  status: VaultStatus,
  destination: string,
  amountSats: number,
  feeSats: number,
  changeSats: number,
) {
  await page.evaluate(
    async ({ fixturePath, currentStatus, destAddress, amount, fee, change }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      fixture.seedReviewedVtxoSpend(currentStatus, destAddress, amount, fee, change)
    },
    {
      fixturePath: UI_FIXTURE,
      currentStatus: status,
      destAddress: destination,
      amount: amountSats,
      fee: feeSats,
      change: changeSats,
    },
  )
}

async function refreshHome(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('vault-balance')).not.toHaveAttribute('aria-busy', 'true')
}

async function installRoutes(page: Page, getStatus: () => VaultStatus | undefined, state: VaultUiState) {
  await page.route('**/v1/status*', async (route) => {
    const url = new URL(route.request().url())
    const status = getStatus()
    if (url.searchParams.has('vault')) {
      return status ? json(route, status) : json(route, { error: 'Vault fixture is not installed yet' }, 503)
    }
    return json(route, {
      network: 'mutinynet',
      clientOrigin: 'http://localhost:3003',
      rpId: 'localhost',
      templateVersion: SAVINGS_TEMPLATE,
      policyVersion: POLICY_VERSION,
      enrollmentMode: 'token',
    })
  })
  await page.route('**/v1/vtxo/operation*', (route) => json(route, { error: 'operation not found' }, 404))
  await page.route('**/esplora/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/esplora/blocks/tip/height') return route.fulfill({ status: 200, body: '1' })
    if (url.pathname === '/esplora/tx' && request.method() === 'POST') {
      return route.fulfill({ status: 200, body: 'dd'.repeat(32) })
    }
    const addressUtxos = url.pathname.match(/^\/esplora\/address\/([^/]+)\/utxo$/)
    if (addressUtxos) {
      const status = getStatus()
      const address = decodeURIComponent(addressUtxos[1])
      if (address === status?.savingsAddress) return json(route, state.savingsUtxos)
      if (address === status?.vtxoBoardingAddress) return json(route, state.boardingUtxos)
      return json(route, [])
    }
    const addressTxs = url.pathname.match(/^\/esplora\/address\/([^/]+)\/txs(?:\/chain\/[^/]+)?$/)
    if (addressTxs) {
      const address = decodeURIComponent(addressTxs[1])
      return json(route, address === getStatus()?.savingsAddress ? state.savingsTxs : [])
    }
    return json(route, { error: `unhandled Esplora fixture path ${url.pathname}` }, 404)
  })
}

async function openVault(page: Page, initial: Partial<VaultUiState> = {}, options: OpenVaultOptions = {}) {
  let status: VaultStatus | undefined
  const state: VaultUiState = {
    boardingUtxos: initial.boardingUtxos || [],
    savingsTxs: initial.savingsTxs || [],
    savingsUtxos: initial.savingsUtxos || [],
  }
  await installRoutes(page, () => status, state)
  await setOperatorState({
    available: options.operatorAvailable !== false,
    vtxos: options.operatorVtxos || [],
  })
  await page.goto('/')
  const installed = await page.evaluate(async (fixturePath) => {
    const fixture = await import(/* @vite-ignore */ fixturePath)
    return { destination: fixture.VAULT_UI_DESTINATION, status: fixture.installVaultUiSession() }
  }, UI_FIXTURE)
  const currentStatus = installed.status as VaultStatus
  status = currentStatus
  await options.beforeReload?.(page, currentStatus)
  await page.reload()
  await expect(page.getByTestId('account-switcher')).toBeVisible()
  if (options.waitForBalance !== false) {
    try {
      await expect(page.getByTestId('vault-balance')).not.toHaveText('—', { timeout: 15_000 })
    } catch (error) {
      const operator = await fetch(OPERATOR_CONTROL).then((response) => response.text())
      throw new Error(`Vault Home did not finish loading. Operator fixture: ${operator}`, { cause: error })
    }
  }
  return { destination: installed.destination as string, state, status: currentStatus }
}

async function clearVaultWorkers(context: BrowserContext) {
  for (const page of context.pages()) {
    await page
      .evaluate(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(
          registrations.filter((item) => item.scope.includes('/__vault-wallet/')).map((item) => item.unregister()),
        )
      })
      .catch(() => undefined)
  }
}

test.afterEach(async ({ context }) => {
  await clearVaultWorkers(context)
  await setOperatorVtxos()
})

test('renders the Spending BIP21 request and copies each underlying address', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3003' })
  const { status } = await openVault(page)

  await page.getByTestId('account-receive').click()
  await expect(page.getByRole('heading', { name: 'Receive to Spending' })).toBeVisible()
  await expect(page.locator('.vault-receive-qr-large svg')).toBeVisible()
  await expect(page.getByTestId('receive-address')).toHaveCount(0)

  await page.getByTestId('receive-arkade-address').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(status.spendingArkAddress)

  await page.getByTestId('receive-bitcoin-address').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(status.vtxoBoardingAddress)

  await page.getByRole('button', { name: 'Copy payment request' }).click()
  const request = await page.evaluate(() => navigator.clipboard.readText())
  expect(decodeVaultBip21(request)).toEqual({
    bitcoinAddress: status.vtxoBoardingAddress,
    arkadeAddress: status.spendingArkAddress,
  })
})

test('ignores another vault worker update and refreshes on the matching update', async ({ page }) => {
  const { status } = await openVault(page)
  await expect(page.getByTestId('vault-balance')).toContainText('0')

  await setOperatorVtxos([await wireVtxo(page, status, { amount: 25_000, txid: VTXO_TXID })])
  await dispatchUtxoUpdate(page, 'another-vault')
  await page.waitForTimeout(350)
  await expect(page.getByTestId('vault-balance')).toContainText('0')

  await dispatchUtxoUpdate(page, status.vaultId)
  await expect(page.getByTestId('vault-balance')).toContainText('25,000')
  await expect(page.getByTestId(`vault-tx-${VTXO_TXID}`)).toBeVisible()
})

test('loads Spending while another tab holds the foreground Lightning lock', async ({ context, page }) => {
  const blocker = await context.newPage()
  await blocker.goto('/')
  await blocker.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      __vaultLightningLockHeld?: boolean
      __releaseVaultLightningLock?: () => void
    }
    void navigator.locks.request('arkade-vault-lightning:e2e-vault-ui', { mode: 'exclusive' }, async () => {
      state.__vaultLightningLockHeld = true
      await new Promise<void>((resolve) => {
        state.__releaseVaultLightningLock = resolve
      })
    })
  })
  await expect
    .poll(() =>
      blocker.evaluate(() =>
        Boolean((globalThis as typeof globalThis & { __vaultLightningLockHeld?: boolean }).__vaultLightningLockHeld),
      ),
    )
    .toBe(true)

  try {
    await openVault(page)
    await expect(page.getByTestId('vault-balance')).toContainText('0')
  } finally {
    await blocker.evaluate(() =>
      (globalThis as typeof globalThis & { __releaseVaultLightningLock?: () => void }).__releaseVaultLightningLock?.(),
    )
  }
})

test('keeps cached Spending balance and history during an open-session outage, then refreshes', async ({
  context,
  page,
}) => {
  const { status } = await openVault(page)
  const cached = await wireVtxo(page, status, { amount: 25_000, txid: VTXO_TXID })
  await setOperatorVtxos([cached])
  await dispatchUtxoUpdate(page, status.vaultId)
  await expect(page.getByTestId('vault-balance')).toContainText('25,000')
  await expect(page.getByTestId(`vault-tx-${VTXO_TXID}`)).toBeVisible()

  const nextTxid = 'ab'.repeat(32)
  await setOperatorVtxos([
    { ...cached, isSpent: true, spentBy: nextTxid, arkTxid: nextTxid },
    await wireVtxo(page, status, { amount: 30_000, txid: nextTxid }),
  ])
  await context.setOffline(true)
  await refreshHome(page)
  await expect(page.getByTestId('vault-balance')).toContainText('25,000')
  await expect(page.getByTestId(`vault-tx-${VTXO_TXID}`)).toBeVisible()

  await context.setOffline(false)
  await dispatchUtxoUpdate(page, status.vaultId)
  await expect(page.getByTestId('vault-balance')).toContainText('30,000')
  await expect(page.getByTestId(`vault-tx-${VTXO_TXID}`)).toBeVisible()
})

test('fails closed without an Operator cache and recovers through Retry', async ({ page }) => {
  const { status } = await openVault(page, {}, { operatorAvailable: false, waitForBalance: false })
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(page.getByText('Activity is unavailable. Refresh to try again.')).toBeVisible()
  await expect(page.getByTestId('vault-balance')).toHaveText('—')

  await setOperatorVtxos([await wireVtxo(page, status, { amount: 25_000, txid: VTXO_TXID })])
  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByTestId('vault-balance')).toContainText('25,000')
  await expect(page.getByTestId(`vault-tx-${VTXO_TXID}`)).toBeVisible()
})

test('renders an exact reviewed VTXO send before approval', async ({ page }) => {
  const { destination, status } = await openVault(page)
  await setOperatorVtxos([await wireVtxo(page, status, { amount: 20_000, txid: VTXO_TXID })])
  await dispatchUtxoUpdate(page, status.vaultId)
  await expect(page.getByTestId('vault-balance')).toContainText('20,000')
  await seedReviewedSpend(page, status, destination, 12_000, 500, 7_500)

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('20,000 / 100,000 available today')).toBeVisible()
  await page.getByTestId('vault-send-amount').fill('12000')
  await page.getByPlaceholder('Arkade address or Lightning invoice').fill(destination)
  await page.getByRole('button', { name: 'Review send' }).click()

  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()
  await expect(page.getByText('12,000 SATS', { exact: true })).toBeVisible()
  await expect(page.getByText(destination, { exact: true })).toBeVisible()
  await expect(page.getByText('500 SATS', { exact: true })).toBeVisible()
  await expect(page.getByText('12,500 SATS', { exact: true })).toBeVisible()
  await expect(page.getByText('Vault service', { exact: true })).toBeVisible()
  await expect(page.getByText('Approves if under today’s limit', { exact: true })).toBeVisible()
  await expect(page.getByText('Hardware', { exact: true })).toBeVisible()
  await expect(page.getByText('Not needed for this send', { exact: true })).toBeVisible()
})

test('renders an exact no-change VTXO send with the resolved time before its receive', async ({ page }) => {
  const { status } = await openVault(page)
  const inputTxid = '21'.repeat(32)
  const sendTxid = '31'.repeat(32)
  const receivedAt = Date.UTC(2026, 7, 20, 10, 0, 0)
  const sentAt = Date.UTC(2026, 7, 21, 12, 2, 0)
  const input = await wireVtxo(page, status, {
    amount: 12_500,
    txid: inputTxid,
    createdAt: receivedAt,
    isSpent: true,
    spentBy: sendTxid,
    arkTxid: sendTxid,
  })
  const resolver = {
    ...(await wireVtxo(page, status, { amount: 1, txid: sendTxid, createdAt: sentAt })),
    script: `5120${'99'.repeat(32)}`,
  }
  await setOperatorVtxos([input, resolver])
  await dispatchUtxoUpdate(page, status.vaultId)

  const sent = page.getByTestId(`vault-tx-${sendTxid}`)
  await expect(page.getByTestId('vault-balance')).toContainText('0')
  await expect(sent).toContainText('Sent')
  await expect(sent).toContainText('12,500 SATS')
  const expectedTime = await page.evaluate(
    (timestamp) => new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp)),
    sentAt,
  )
  await expect(sent).toContainText(`Confirmed · ${expectedTime}`)
  const rows = page.locator('[data-testid^="vault-tx-"]')
  await expect(rows.nth(0)).toHaveAttribute('data-testid', `vault-tx-${sendTxid}`)
  await expect(rows.nth(1)).toHaveAttribute('data-testid', `vault-tx-${inputTxid}`)
})

test('nets VTXO change into one rendered send and omits it as a receive', async ({ page }) => {
  const { status } = await openVault(page)
  const inputTxid = '41'.repeat(32)
  const sendTxid = '51'.repeat(32)
  const input = await wireVtxo(page, status, {
    amount: 20_000,
    txid: inputTxid,
    createdAt: Date.UTC(2026, 7, 20, 10, 0, 0),
    isSpent: true,
    spentBy: sendTxid,
    arkTxid: sendTxid,
  })
  const change = await wireVtxo(page, status, {
    amount: 7_500,
    txid: sendTxid,
    vout: 1,
    createdAt: Date.UTC(2026, 7, 21, 12, 2, 0),
  })
  await setOperatorVtxos([input, change])
  await dispatchUtxoUpdate(page, status.vaultId)

  const sent = page.getByTestId(`vault-tx-${sendTxid}`)
  await expect(page.getByTestId('vault-balance')).toContainText('7,500')
  await expect(sent).toHaveCount(1)
  await expect(sent).toContainText('Sent')
  await expect(sent).toContainText('12,500 SATS')
  await expect(sent).not.toContainText('Received')
  await expect(page.getByTestId(`vault-tx-${inputTxid}`)).toContainText('Received')
})

test('shows boarding value immediately, then replaces it with the confirmed VTXO without double counting', async ({
  page,
}) => {
  const pending: EsploraUtxo = {
    txid: BOARDING_TXID,
    vout: 0,
    value: 50_000,
    status: { confirmed: false },
  }
  const { state, status } = await openVault(page, { boardingUtxos: [pending] })

  await expect(page.getByTestId('vault-balance')).toContainText('50,000')
  await expect(page.getByTestId(`vault-tx-${BOARDING_TXID}`)).toContainText('Pending')

  await seedIntent(page, 'waiting_for_batch')
  state.boardingUtxos = [{ ...pending, status: { confirmed: true, block_height: 101 } }]
  await refreshHome(page)
  await expect(page.getByTestId('vault-balance')).toContainText('50,000')

  await seedIntent(page, 'batch_succeeded', COMMITMENT_TXID)
  await setOperatorVtxos([
    await wireVtxo(page, status, {
      amount: 49_000,
      txid: VTXO_TXID,
      commitmentTxids: [COMMITMENT_TXID],
    }),
  ])
  await refreshHome(page)

  await expect(page.getByTestId('vault-balance')).toContainText('49,000')
  await expect(page.getByTestId(`vault-tx-${BOARDING_TXID}`)).toHaveCount(0)
  await expect(page.getByTestId(`vault-tx-${COMMITMENT_TXID}`)).toContainText('Confirmed')
})

test('does not reopen Face ID or start another boarding operation for a fresh active intent', async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    const tracked = globalThis as typeof globalThis & { __vaultCredentialGets?: number }
    tracked.__vaultCredentialGets = 0
    Object.defineProperty(navigator.credentials, 'get', {
      configurable: true,
      value: async () => {
        tracked.__vaultCredentialGets = (tracked.__vaultCredentialGets || 0) + 1
        throw new DOMException('Unexpected credential request', 'NotAllowedError')
      },
    })
  })
  const confirmed: EsploraUtxo = {
    txid: BOARDING_TXID,
    vout: 0,
    value: 50_000,
    status: { confirmed: true, block_height: 101 },
  }
  const { state, status } = await openVault(
    page,
    { boardingUtxos: [confirmed] },
    { beforeReload: async (currentPage) => seedIntent(currentPage, 'waiting_for_batch') },
  )
  await expect(page.getByTestId('vault-balance')).toContainText('50,000')

  const pageB = await context.newPage()
  await installRoutes(pageB, () => status, state)
  await pageB.goto('/')
  await expect(pageB.getByTestId('account-switcher')).toBeVisible()
  await expect(pageB.getByTestId('vault-balance')).toContainText('50,000')

  await Promise.all([page.reload(), pageB.reload()])
  // Both tabs deliberately reinitialize the same scoped worker and IndexedDB
  // state at once. Keep the fund-safety assertion exact while allowing the
  // normal worker activation/serialization path to complete under CI load.
  await expect(page.getByTestId('vault-balance')).toContainText('50,000', { timeout: 15_000 })
  await expect(pageB.getByTestId('vault-balance')).toContainText('50,000', { timeout: 15_000 })
  await Promise.all(
    [page, pageB].map((currentPage) =>
      currentPage.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          }),
      ),
    ),
  )
  const credentialRequests = await Promise.all(
    [page, pageB].map((currentPage) =>
      currentPage.evaluate(
        () => (globalThis as typeof globalThis & { __vaultCredentialGets?: number }).__vaultCredentialGets || 0,
      ),
    ),
  )
  expect(credentialRequests).toEqual([0, 0])
  const operator = await readOperatorState()
  expect(operator.requests.some((request) => request.includes('/v1/batch/registerIntent'))).toBe(false)
})

test('recovers a missed VTXO update after reconnect and updates the rendered Home balance', async ({
  context,
  page,
}) => {
  const { status } = await openVault(page)
  await expect(page.getByTestId('vault-balance')).toContainText('0')

  const incoming = await wireVtxo(page, status, { amount: 25_000, txid: VTXO_TXID })
  await context.setOffline(true)
  await setOperatorVtxos([incoming])
  await expect(page.getByTestId('vault-balance')).toContainText('0')

  await context.setOffline(false)
  await refreshHome(page)
  await expect(page.getByTestId('vault-balance')).toContainText('25,000')
  await expect(page.getByTestId(`vault-tx-${VTXO_TXID}`)).toBeVisible()
})

test('never treats visible boarding value as spendable VTXO balance', async ({ page }) => {
  const pending: EsploraUtxo = {
    txid: BOARDING_TXID,
    vout: 0,
    value: 50_000,
    status: { confirmed: false },
  }
  const { destination, status } = await openVault(page, { boardingUtxos: [pending] })
  await setOperatorVtxos([await wireVtxo(page, status, { amount: 20_000, txid: VTXO_TXID })])
  await refreshHome(page)
  await expect(page.getByTestId('vault-balance')).toContainText('70,000')

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByTestId('vault-send-amount').fill('30000')
  await page.getByPlaceholder('Arkade address or Lightning invoice').fill(destination)
  await page.getByRole('button', { name: 'Review send' }).click()

  await expect(page.getByText('Not enough confirmed spending funds.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review' })).toHaveCount(0)
})

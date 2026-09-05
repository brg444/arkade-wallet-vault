import AxeBuilder from '@axe-core/playwright'
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { resolve } from 'node:path'
import { decodeVaultBip21 } from '../../lib/vault/bip21'
import { POLICY_VERSION } from '../../lib/vault/constants'
import { SAVINGS_TEMPLATE } from '../../lib/vault/program/constants'
import type { VaultStatus } from '../../lib/vault/types'

const UI_FIXTURE = '/src/test/e2e-vault/fixtures/vault-ui.ts'
const WORKER_FIXTURE = '/src/test/e2e-vault/fixtures/vtxo-browser.ts'
const APP_PORT = process.env.VAULT_E2E_PORT || '3003'
const OPERATOR_PORT = process.env.VAULT_E2E_OPERATOR_PORT || '18888'
const APP_ORIGIN = `http://localhost:${APP_PORT}`
const OPERATOR_ORIGIN = `http://127.0.0.1:${OPERATOR_PORT}`
const OPERATOR_CONTROL = `${OPERATOR_ORIGIN}/__vault_e2e_operator`
const AUTHORIZER_CONTROL = `${OPERATOR_ORIGIN}/__vault_e2e_authorizer`
const ESPLORA_CONTROL = `${OPERATOR_ORIGIN}/__vault_e2e_esplora`
const BOARDING_TXID = '11'.repeat(32)
const SAVINGS_TXID = '22'.repeat(32)
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

async function setAuthorizerStatus(status: VaultStatus) {
  const response = await fetch(AUTHORIZER_CONTROL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(status),
  })
  if (!response.ok) throw new Error(`Authorizer fixture reset failed: ${response.status}`)
}

async function setEsploraState(status: VaultStatus, state: VaultUiState) {
  const response = await fetch(ESPLORA_CONTROL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      boardingAddress: status.vtxoBoardingAddress,
      boardingUtxos: state.boardingUtxos,
      savingsAddress: status.savingsAddress,
      savingsTxs: state.savingsTxs,
      savingsUtxos: state.savingsUtxos,
    }),
  })
  if (!response.ok) throw new Error(`Esplora fixture reset failed: ${response.status}`)
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

async function dispatchUtxoUpdate(page: Page, vaultId: string) {
  await page.evaluate(
    async ({ fixturePath, id }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      fixture.dispatchWalletUtxoUpdate(id)
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
  await page.route('**/ready', (route) =>
    json(route, {
      ok: true,
      schema: 7,
      network: 'mutinynet',
      enrollTemplate: SAVINGS_TEMPLATE,
      arkadeOrigin: OPERATOR_ORIGIN,
      arkadeVersion: 'e2e',
    }),
  )
  await page.route('**/v1/status*', async (route) => {
    const url = new URL(route.request().url())
    const status = getStatus()
    if (url.searchParams.has('vault')) {
      return status ? json(route, status) : json(route, { error: 'Vault fixture is not installed yet' }, 503)
    }
    return json(route, {
      network: 'mutinynet',
      clientOrigin: APP_ORIGIN,
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
    return { destination: fixture.VAULT_UI_DESTINATION, status: await fixture.installVaultUiSession() }
  }, UI_FIXTURE)
  const currentStatus = installed.status as VaultStatus
  status = currentStatus
  await setAuthorizerStatus(currentStatus)
  await setEsploraState(currentStatus, state)
  await page.reload()
  await expect(page.getByTestId('account-switcher')).toBeVisible()
  if (options.waitForBalance !== false) {
    try {
      await expect(page.getByTestId('vault-balance')).not.toHaveText('—', { timeout: 15_000 })
    } catch (error) {
      const operator = await fetch(OPERATOR_CONTROL).then((response) => response.text())
      const runtimeError = await page.evaluate(
        async ({ currentStatus, workerPath }) => {
          const worker = await import(/* @vite-ignore */ workerPath)
          try {
            await worker.ensureVaultWalletWorker(currentStatus)
            return 'none'
          } catch (failure) {
            return failure instanceof Error ? failure.stack || failure.message : String(failure)
          }
        },
        { currentStatus, workerPath: '/src/lib/vault/vtxo/walletWorker.ts' },
      )
      throw new Error(`Vault Home did not finish loading. Runtime: ${runtimeError}. Operator fixture: ${operator}`, {
        cause: error,
      })
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

test('@docs captures the current mobile wallet journey', async ({ page }) => {
  const output = (name: string) => resolve('docs/images/wallet', name)
  const pending: EsploraUtxo = {
    txid: BOARDING_TXID,
    vout: 0,
    value: 48_000,
    status: { confirmed: false },
  }
  const { destination, status } = await openVault(page, {
    boardingUtxos: [pending],
    savingsUtxos: [
      {
        txid: SAVINGS_TXID,
        vout: 0,
        value: 100_000,
        status: { confirmed: true, block_height: 1 },
      },
    ],
  })
  await setOperatorVtxos([
    await wireVtxo(page, status, {
      amount: 80_000,
      txid: VTXO_TXID,
      createdAt: Date.UTC(2026, 7, 20, 10, 0, 0),
    }),
  ])
  await refreshHome(page)
  await page.screenshot({ path: output('home-spending-mobile.png'), animations: 'disabled', fullPage: true })

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByTestId('account-savings').click()
  await expect(page.getByTestId('vault-balance')).toContainText('100,000')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: output('home-savings-mobile.png'), animations: 'disabled', fullPage: true })

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByTestId('account-spend').click()
  await page.getByTestId('account-receive').click()
  await page.screenshot({ path: output('receive-mobile.png'), animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()

  await seedReviewedSpend(page, status, destination, 12_000, 500, 67_500)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByTestId('vault-send-amount').fill('12000')
  await page.getByPlaceholder('Payment address or Lightning invoice').fill(destination)
  await page.getByRole('button', { name: 'Resume payment' }).click()
  await expect(page.getByRole('heading', { name: 'Review payment' })).toBeVisible()
  await page.screenshot({ path: output('review-payment-mobile.png'), animations: 'disabled', fullPage: true })

  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByTestId('tab-vault').click()
  await page.screenshot({ path: output('security-mobile.png'), animations: 'disabled', fullPage: true })
  await page.getByTestId('security-kit').click()
  await page.screenshot({ path: output('recovery-kit-mobile.png'), animations: 'disabled', fullPage: true })
})

test('renders the Spending BIP21 request and copies each underlying address', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN })
  const { status } = await openVault(page)

  await page.getByTestId('account-receive').click()
  await expect(page.getByRole('heading', { name: 'Receive' })).toBeVisible()
  await expect(page.locator('.vault-receive-qr-large svg')).toBeVisible()
  await expect(page.getByTestId('receive-address')).toHaveCount(0)

  await page.getByTestId('receive-arkade-address').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(status.spendingArkAddress)

  await page.getByTestId('receive-bitcoin-address').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(status.vtxoBoardingAddress)

  await page.getByRole('button', { name: 'Share' }).click()
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

test('switches the Home balance between sats and USD using the live price feed', async ({ page }) => {
  await page.route('https://blockchain.info/ticker', (route) =>
    json(route, {
      USD: { last: 125_000 },
    }),
  )
  const { status } = await openVault(page)
  await setOperatorVtxos([await wireVtxo(page, status, { amount: 128_000, txid: VTXO_TXID })])
  await dispatchUtxoUpdate(page, status.vaultId)

  const balance = page.getByTestId('vault-balance')
  await expect(balance).toContainText('₿128,000')
  await balance.click()
  await expect(balance).toContainText('$160.00')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('arkade-vault-balance-unit'))).toBe('usd')

  await balance.click()
  await expect(balance).toContainText('₿128,000')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('arkade-vault-balance-unit'))).toBeNull()
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
  await expect(page.getByText('Rolling 24-hour limit')).toBeVisible()
  await expect(page.getByText('20,000 of 100,000 remaining')).toBeVisible()
  await page.getByTestId('vault-send-amount').fill('12000')
  await page.getByPlaceholder('Payment address or Lightning invoice').fill(destination)
  await page.getByRole('button', { name: 'Resume payment' }).click()

  await expect(page.getByRole('heading', { name: 'Review payment' })).toBeVisible()
  await expect(page.getByText('₿12,000', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reveal' }).click()
  await expect(page.getByRole('region', { name: 'Payment details' }).locator('strong').first()).toContainText(
    destination,
  )
  await expect(page.getByText('₿500', { exact: true })).toBeVisible()
  await expect(page.getByText('₿12,500', { exact: true })).toBeVisible()
  await expect(page.getByText('Vault service', { exact: true })).toBeVisible()
  await expect(page.getByText('Automatic if this payment is within your limits')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve payment' })).toBeVisible()
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
  await expect(sent).toContainText('₿12,500')
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
  await expect(sent).toContainText('₿12,500')
  await expect(sent).not.toContainText('Received')
  await expect(page.getByTestId(`vault-tx-${inputTxid}`)).toContainText('Received')
})

test('shows a pending boarding deposit, then replaces it with the confirmed VTXO without double counting', async ({
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
  await expect(page.getByTestId('spending-pending')).toContainText('₿50,000 arriving')
  await expect(page.getByTestId('spending-total')).toHaveCount(0)
  await expect(page.getByTestId(`vault-tx-${BOARDING_TXID}`)).toContainText('Pending')

  state.boardingUtxos = []
  await setEsploraState(status, state)
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
  await expect(page.getByTestId('spending-pending')).toContainText('₿50,000 arriving')
  await expect(page.getByTestId('spending-total')).toHaveCount(0)

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByLabel('Spending capacity')).toContainText('₿20,000')
  await page.getByTestId('vault-send-amount').fill('30000')
  await page.getByPlaceholder('Payment address or Lightning invoice').fill(destination)
  await expect(page.getByRole('button', { name: 'Review payment' })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'Review' })).toHaveCount(0)
})

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    }))
  expect(blocking).toEqual([])
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow).toEqual({ document: 0, body: 0 })
}

async function expectReachableAbove(page: Page, targetSelector: string, chromeSelector: string) {
  const target = page.locator(targetSelector)
  await target.scrollIntoViewIfNeeded()
  let targetBox = await target.boundingBox()
  let chromeBox = await page.locator(chromeSelector).boundingBox()
  expect(targetBox).not.toBeNull()
  expect(chromeBox).not.toBeNull()
  const overlap = targetBox!.y + targetBox!.height - chromeBox!.y
  if (overlap > 0) {
    await page.locator('.content').evaluate((content, amount) => content.scrollBy(0, amount + 16), overlap)
    targetBox = await target.boundingBox()
    chromeBox = await page.locator(chromeSelector).boundingBox()
  }
  expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(chromeBox!.y)
}

test('@polish keeps installed-PWA safe areas inside the wallet canvas', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Mobile Chrome', 'Mobile shell regression')
  await openVault(page)

  const app = page.getByTestId('vault-app')
  await app.evaluate((element) => {
    element.style.setProperty('--vault-safe-area-top', '47px')
    element.style.setProperty('--vault-safe-area-bottom', '34px')
  })

  const viewport = page.viewportSize()
  const frame = await app.boundingBox()
  const accountBar = await page.locator('.vault-account-bar').boundingBox()
  const navigationTrigger = await page.getByRole('button', { name: 'Open navigation' }).boundingBox()
  const statusBarOverlay = await page.evaluate(() => getComputedStyle(document.body, '::before').display)

  expect(viewport).not.toBeNull()
  expect(frame).not.toBeNull()
  expect(accountBar).not.toBeNull()
  expect(navigationTrigger).not.toBeNull()
  expect(frame!.y).toBe(0)
  expect(frame!.height).toBe(viewport!.height)
  expect(accountBar!.y).toBeGreaterThanOrEqual(47)
  expect(navigationTrigger!.y).toBeGreaterThan((viewport!.height || 0) / 2)
  expect(navigationTrigger!.y + navigationTrigger!.height).toBeLessThanOrEqual(viewport!.height)
  expect(navigationTrigger!.x + navigationTrigger!.width).toBeGreaterThanOrEqual((viewport!.width || 0) - 1)
  expect(navigationTrigger!.width).toBeLessThan(navigationTrigger!.height)
  expect(statusBarOverlay).toBe('none')
  await expectNoHorizontalOverflow(page)
})

test('@polish keeps a focused send address between the safe header and footer when the keyboard opens', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'Mobile Chrome', 'Mobile keyboard regression')
  const { status } = await openVault(page)
  await setOperatorVtxos([await wireVtxo(page, status, { amount: 20_000, txid: VTXO_TXID })])
  await dispatchUtxoUpdate(page, status.vaultId)
  await expect(page.getByTestId('vault-balance')).toContainText('20,000')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const destination = page.getByPlaceholder('Payment address or Lightning invoice')
  await destination.focus()
  await page.setViewportSize({ width: 390, height: 500 })
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))

  await expect
    .poll(async () => {
      const header = await page.locator('.qg-header').boundingBox()
      const field = await page.locator('.qg-dest-field').boundingBox()
      const footer = await page.locator('.qg-footer').boundingBox()
      return {
        headerTop: Math.round(header?.y ?? -1),
        fieldBottom: Math.round((field?.y ?? 0) + (field?.height ?? 0)),
        footerTop: Math.round(footer?.y ?? 0),
      }
    })
    .toMatchObject({ headerTop: 0 })

  const field = await page.locator('.qg-dest-field').boundingBox()
  const footer = await page.locator('.qg-footer').boundingBox()
  expect(field).not.toBeNull()
  expect(footer).not.toBeNull()
  expect(field!.y + field!.height).toBeLessThanOrEqual(footer!.y)
})

test('@polish covers accessible account, send, Security, and Settings states', async ({ page }) => {
  const pending: EsploraUtxo = {
    txid: BOARDING_TXID,
    vout: 0,
    value: 48_000,
    status: { confirmed: false },
  }
  const { destination, state, status } = await openVault(page, {
    boardingUtxos: [pending],
    savingsUtxos: [
      {
        txid: SAVINGS_TXID,
        vout: 0,
        value: 100_000,
        status: { confirmed: true, block_height: 1 },
      },
    ],
  })
  await setOperatorVtxos([
    await wireVtxo(page, status, {
      amount: 80_000,
      txid: VTXO_TXID,
      createdAt: Date.UTC(2026, 7, 20, 10, 0, 0),
    }),
  ])
  await refreshHome(page)

  await expect(page.getByTestId('vault-balance')).toContainText('128,000')
  await expect(page.getByTestId('spending-pending')).toContainText('₿48,000 arriving')
  await expect(page.getByTestId('spending-total')).toHaveCount(0)
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('home-with-pending.png', { animations: 'disabled', fullPage: true })
  const homeViewport = page.viewportSize()
  for (const width of [320, 430, 768] as const) {
    await page.setViewportSize({ width, height: homeViewport?.height || 844 })
    await expectNoHorizontalOverflow(page)
    const balance = await page.getByTestId('vault-balance').boundingBox()
    const send = await page.getByRole('button', { name: 'Send', exact: true }).boundingBox()
    const receive = await page.getByRole('button', { name: 'Receive', exact: true }).boundingBox()
    expect(balance).not.toBeNull()
    expect(send).not.toBeNull()
    expect(receive).not.toBeNull()
    expect(balance!.x + balance!.width).toBeLessThanOrEqual(width)
    expect(send!.x + send!.width).toBeLessThanOrEqual(receive!.x + 1)
  }
  await page.setViewportSize(homeViewport || { width: 390, height: 844 })

  const accountTrigger = page.getByTestId('account-switcher')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await expect(page.getByTestId('account-spend')).toBeVisible()
  await expect(page.getByTestId('account-savings')).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('home-account-menu.png', { animations: 'disabled', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused()

  await page.getByTestId('account-scan').click()
  await expect(page.getByRole('heading', { name: 'Scan payment' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('payment-scanner.png', { animations: 'disabled', fullPage: true })
  const cancelScanner = page.getByRole('button', { name: 'Cancel' })
  if (await cancelScanner.isVisible()) await cancelScanner.click()
  await expect(page.getByTestId('account-switcher')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Send' })).toHaveCount(0)

  await page.getByTestId('account-receive').click()
  await expect(page.getByRole('heading', { name: 'Receive' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('receive-spending.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByTestId('account-spend')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('account-savings').click()
  await expect(accountTrigger).toContainText('Savings')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByTestId('account-savings')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('account-spend').click()
  await expect(accountTrigger).toContainText('Spending')

  await seedReviewedSpend(page, status, destination, 12_000, 500, 67_500)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('send-spending.png', { animations: 'disabled', fullPage: true })
  await page.getByTestId('vault-send-amount').fill('12000')
  await page.getByPlaceholder('Payment address or Lightning invoice').fill(destination)
  await page.getByRole('button', { name: 'Resume payment' }).click()
  await expect(page.getByRole('heading', { name: 'Review payment' })).toBeVisible()
  await expect(page.getByText('Mutinynet', { exact: true })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('send-review.png', { animations: 'disabled', fullPage: true })
  await expectReachableAbove(page, '.qg-approvals', '.qg-footer')

  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByTestId('tab-vault').click()
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0)
  await expect(page.getByTestId('security-readiness')).toContainText('Ready')
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('security.png', { animations: 'disabled', fullPage: true })
  await expect(page.getByTestId('security-lost')).toBeVisible()

  await page.getByTestId('security-kit').click()
  await expect(page.getByRole('heading', { name: 'Recovery Kit' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('recovery-kit.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: /I lost a key/ }).click()
  await expect(page.getByRole('heading', { name: 'Lost a key' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('recovery-lost-key.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Go back' }).click()
  await expect(page.getByTestId('account-switcher')).toBeVisible()

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByTestId('tab-settings').click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('settings.png', { animations: 'disabled', fullPage: true })

  await page.getByTestId('settings-theme').click()
  await expect(page.getByRole('heading', { name: 'Theme' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('settings-theme.png', { animations: 'disabled', fullPage: true })
  await page.getByTestId('select-option-1').click()
  await expect(page.locator('html')).toHaveClass(/palette-dark/)
  await expect(page).toHaveScreenshot('settings-theme-dark.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('settings-dark.png', { animations: 'disabled', fullPage: true })

  await page.getByTestId('settings-theme').click()
  await page.getByTestId('select-option-2').click()
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByTestId('settings-haptics').click()
  await expect(page.getByRole('heading', { name: 'Haptics' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('settings-haptics.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByTestId('settings-about').click()
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('settings-about.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByTestId('settings-logs').click()
  await expect(page.getByRole('heading', { name: 'Logs' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('settings-logs.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByTestId('settings-signout').click()
  await expect(page.getByRole('heading', { name: 'Sign out', exact: true })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('settings-signout.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Go back' }).click()
  await expect(page.getByTestId('account-switcher')).toBeVisible()

  await page.getByRole('button', { name: /Received ₿80,000/ }).click()
  await expect(page.getByRole('heading', { name: 'Transaction' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('transaction-received.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()

  await setEsploraState(status, state)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByTestId('account-savings').click()
  await expect(page.getByTestId('account-switcher')).toContainText('Savings')
  await refreshHome(page)
  await expect(page.getByTestId('vault-balance')).toContainText('100,000')
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('home-savings.png', { animations: 'disabled', fullPage: true })
  await page.getByTestId('account-receive').click()
  await expect(page.getByRole('heading', { name: 'Receive' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('receive-savings.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Spending', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Move to Spending' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('send-savings.png', { animations: 'disabled', fullPage: true })

  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width >= 900 ? 1000 : 844 })
    await expectNoHorizontalOverflow(page)
  }
  const frame = await page.getByTestId('vault-app').boundingBox()
  expect(frame?.width).toBe(720)
  expect(frame?.x).toBe(360)
  expect(frame?.y).toBe(24)
})

// Motion remains enabled here so touch and transition regressions are exercised together.
test.describe('interaction quality', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  test('@interaction native taps, header gestures and menu browsing', async ({ page, browserName }, testInfo) => {
    const { status } = await openVault(page)
    await setOperatorVtxos([await wireVtxo(page, status, { amount: 80_000, txid: VTXO_TXID })])
    await refreshHome(page)
    await expect(page.getByTestId('vault-balance')).toContainText('80,000')
    const open = page.getByRole('button', { name: 'Open navigation' })
    await open.click()
    await expect(page.getByTestId('account-spend')).toBeFocused()
    await expect(page.getByTestId('account-spend')).toHaveCSS('outline-style', 'none')
    await expect(page.getByTestId('account-spend')).toHaveCSS('box-shadow', 'none')
    await expect(page.locator('.content')).toHaveAttribute('inert', '')
    const shell = await page.getByTestId('vault-app').boundingBox()
    const backdrop = await page.locator('.qg-launcher-backdrop').boundingBox()
    expect(Math.abs(shell!.width - backdrop!.width)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: testInfo.outputPath('navigation.png'), animations: 'disabled' })
    for (let index = 0; index < 5; index++) {
      // Mobile WebKit follows the platform's text-only Tab preference.
      if (browserName === 'webkit') await page.locator('.qg-launcher-stack button').nth(index).focus()
      else await page.keyboard.press('Tab')
      await expect(page.locator('.qg-launcher :focus')).toHaveCSS('outline-style', 'none')
      const focusedItem = page.locator('.qg-launcher-item:focus')
      if (await focusedItem.count()) await expect(focusedItem).toHaveCSS('box-shadow', 'none')
    }
    await page.getByTestId('tab-vault').click()
    await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible()
    await page.getByTestId('header-back').click()
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Send', exact: true })).toBeVisible()
    await page.getByTestId('vault-send-amount').fill('12000')
    await expect(page.getByTestId('vault-send-amount')).toHaveCSS('outline-style', 'none')
    await expect(page.getByTestId('vault-send-amount')).toHaveCSS('box-shadow', 'none')
    await page.screenshot({ path: testInfo.outputPath('send.png'), animations: 'disabled' })

    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      const swipe = async (x: number, y: number, dx: number, dy: number, cancel = false) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
        for (let step = 1; step <= 6; step++) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: x + (dx * step) / 6, y: y + (dy * step) / 6 }],
          })
        }
        await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
      }
      const amount = (await page.getByTestId('vault-send-amount').boundingBox())!
      await swipe(amount.x + 40, amount.y + 15, 0, 125)
      await expect(page.getByRole('heading', { name: 'Send', exact: true })).toBeVisible()
      await page.getByTestId('vault-send-amount').blur()
      const heading = (await page.getByTestId('screen-title').boundingBox())!
      await swipe(heading.x + heading.width / 2, heading.y + 5, 0, 120, true)
      await expect(page.getByRole('heading', { name: 'Send', exact: true })).toBeVisible()
      await swipe(heading.x + heading.width / 2, heading.y + 5, 0, 120)
      await expect(open).toBeVisible()
      const tab = (await open.boundingBox())!
      await swipe(tab.x + 20, tab.y + 25, -80, 0, true)
      await expect(page.getByRole('navigation')).toHaveCount(0)
      await swipe(tab.x + 20, tab.y + 25, 0, -70)
      await expect(page.getByRole('navigation')).toHaveCount(0)
      await cdp.detach()
    } else {
      await page.getByTestId('header-back').click()
    }
    await open.click()
    await page.getByTestId('tab-settings').click()
    await page.getByTestId('settings-theme').click()
    await page.getByTestId('select-option-1').click()
    await page.getByTestId('header-back').click()
    await page.getByTestId('header-back').click()
    await page.getByTestId('account-receive').click()
    await expect(page.getByRole('heading', { name: 'Receive', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('receive-dark.png'), animations: 'disabled' })
  })
  test('@interaction address field accepts taps across its full surface', async ({ page, isMobile }, testInfo) => {
    const { status } = await openVault(page)
    await setOperatorVtxos([await wireVtxo(page, status, { amount: 80_000, txid: VTXO_TXID })])
    await refreshHome(page)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const input = page.getByRole('textbox', { name: 'To', exact: true })
    const surface = page.locator('.qg-dest-field > div')
    await expect(input).toBeVisible()
    const restingBorder = await surface.evaluate((element) => getComputedStyle(element).borderColor)
    const hits = await surface.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return [5, box.height / 2, box.height - 5].map(
        (y) => document.elementFromPoint(box.left + 24, box.top + y)?.tagName,
      )
    })
    expect(hits).toEqual(['INPUT', 'INPUT', 'INPUT'])
    for (const fraction of [0.1, 0.5, 0.9]) {
      await page.getByTestId('screen-title').click()
      const box = (await surface.boundingBox())!
      if (isMobile) await page.touchscreen.tap(box.x + 24, box.y + box.height * fraction)
      else await page.mouse.click(box.x + 24, box.y + box.height * fraction)
      await expect(input).toBeFocused()
    }
    await input.fill('example destination')
    await input.dblclick()
    expect(
      await input.evaluate((element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!),
    ).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Scan destination', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Scan payment', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(input).toHaveValue('example destination')
    await input.focus()
    await expect(input).toHaveCSS('outline-style', 'none')
    await expect(input).toHaveCSS('box-shadow', 'none')
    await expect(surface).toHaveCSS('box-shadow', 'none')
    await expect(surface).toHaveCSS('border-color', restingBorder)
    await page.screenshot({ path: testInfo.outputPath('address-focus.png'), animations: 'disabled' })
  })
  test('@interaction launcher follows the grab point and remembers placement', async ({
    page,
    browserName,
  }, testInfo) => {
    await openVault(page)
    const tab = page.getByRole('button', { name: 'Open navigation' })
    const start = (await tab.boundingBox())!
    expect(start.width).toBeGreaterThanOrEqual(56)
    const x = start.x + 8
    const y = start.y + 10
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 3, y - 16)
    await page.mouse.move(x - 120, y - 180, { steps: 12 })
    await expect.poll(async () => (await tab.boundingBox())!.y).toBeCloseTo(start.y - 180, 0)
    expect((await tab.boundingBox())!.x).toBeCloseTo(start.x, 0)
    await page.mouse.up()
    await expect(page.getByRole('navigation')).toHaveCount(0)
    const placed = (await tab.boundingBox())!
    await page.reload()
    await expect(tab).toBeVisible()
    await expect.poll(async () => (await tab.boundingBox())!.y).toBeCloseTo(placed.y, 0)

    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page)
      const box = (await tab.boundingBox())!
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: box.x + 20, y: box.y + 12 }],
      })
      for (let step = 1; step <= 10; step++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: box.x + 20 - step * 2, y: box.y + 12 + step * 8 }],
        })
      }
      await expect.poll(async () => (await tab.boundingBox())!.y).toBeCloseTo(box.y + 80, 0)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
      await expect.poll(async () => (await tab.boundingBox())!.y).toBeCloseTo(box.y, 0)
      await expect(page.getByRole('navigation')).toHaveCount(0)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: box.x + 20, y: box.y + 12 }],
      })
      for (let step = 1; step <= 10; step++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: box.x + 20, y: box.y + 12 + step * 8 }],
        })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect.poll(async () => (await tab.boundingBox())!.y).toBeCloseTo(box.y + 80, 0)
      await expect(page.getByRole('navigation')).toHaveCount(0)
      await cdp.detach()
      await page.reload()
      await expect(tab).toBeVisible()
      await expect.poll(async () => (await tab.boundingBox())!.y).toBeCloseTo(box.y + 80, 0)
    }

    // Place at the upper edge and verify that the complete menu stays in the wallet frame.
    const current = (await tab.boundingBox())!
    await page.mouse.move(current.x + 12, current.y + 12)
    await page.mouse.down()
    await page.mouse.move(current.x + 12, 0, { steps: 12 })
    await page.mouse.up()
    await tab.click()
    const menu = page.getByRole('navigation')
    const frame = (await page.getByTestId('vault-app').boundingBox())!
    const menuBox = (await menu.boundingBox())!
    expect(menuBox.y).toBeGreaterThanOrEqual(frame.y)
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(frame.y + frame.height)
    await page.screenshot({ path: testInfo.outputPath('launcher-upper.png'), animations: 'disabled' })
    await page.getByRole('button', { name: 'Close navigation' }).click()
    await expect(tab).toBeVisible()
    await page.setViewportSize({ width: 390, height: 520 })
    const resizedFrame = (await page.getByTestId('vault-app').boundingBox())!
    await expect.poll(async () => (await tab.boundingBox())!.y).toBeGreaterThanOrEqual(resizedFrame.y)
    const resizedTab = (await tab.boundingBox())!
    expect(resizedTab.y + resizedTab.height).toBeLessThanOrEqual(resizedFrame.y + resizedFrame.height)
  })
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { decodeVaultBip21 } from '../../lib/vault/bip21'
import { POLICY_VERSION } from '../../lib/vault/constants'
import { SAVINGS_TEMPLATE } from '../../lib/vault/program/constants'
import type { VaultStatus } from '../../lib/vault/types'

const UI_FIXTURE = '/src/test/e2e-vault/fixtures/vault-ui.ts'
const WORKER_FIXTURE = '/src/test/e2e-vault/fixtures/vtxo-browser.ts'
const KIT_STORE_MODULE = '/src/lib/vault/program/kitStore.ts'
const RECOVERY_SPEND_MODULE = '/src/lib/vault/program/spend.ts'
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
const MUTINYNET_INVOICE =
  'lntbs21u1p4ghty5pp500cgfavsavx2prgw3vm4s6ckrjvg9zyjx3k87segw240hr2l2glqdqqcqzzsxqyz5vqsp56tscwj6zyk4k9g2xm4r0tf7s6xemuq2rqm7vea0tfymmzwapaqlq9qxpqysgq49fj3f48wy2utl25xzs8tjg7ak89p3242p2h3e9rk20alxajjqarjusq8222fsa9ncy43ucslfdcdtld2pd58hcxtndmjf0sfyqsf2qpsf0h6s'
const MUTINYNET_INVOICE_TIMESTAMP = 1_787_538_580

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

async function seedLightningActivity(
  page: Page,
  status: VaultStatus,
  input: { rfqId: string; fundingTxid: string; state: 'failed' | 'needs_counterparty' | 'refunded' },
) {
  await page.evaluate(
    async ({ fixturePath, currentStatus, currentInput, invoice, createdAt }) => {
      const fixture = await import(/* @vite-ignore */ fixturePath)
      await fixture.seedVaultLightningActivity(currentStatus, {
        ...currentInput,
        invoice,
        createdAt,
      })
    },
    {
      fixturePath: UI_FIXTURE,
      currentStatus: status,
      currentInput: input,
      invoice: MUTINYNET_INVOICE,
      createdAt: MUTINYNET_INVOICE_TIMESTAMP + 1,
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

async function recoveryKitJson(page: Page, vaultId: string): Promise<string> {
  return page.evaluate(
    async ({ id, storePath }) => {
      const store = await import(/* @vite-ignore */ storePath)
      const kit = store.loadLocalKit(id)
      if (!kit) throw new Error('Recovery Kit fixture is missing')
      return JSON.stringify(kit)
    },
    { id: vaultId, storePath: KIT_STORE_MODULE },
  )
}

async function installPendingRecovery(
  page: Page,
  vaultId: string,
  claimant: 'phone' | 'hardware' | 'recovery',
  utxo: EsploraUtxo,
) {
  const address = await page.evaluate(
    async ({ id, role, storePath }) => {
      const store = await import(/* @vite-ignore */ storePath)
      const kit = store.loadLocalKit(id)
      if (!kit) throw new Error('Recovery Kit fixture is missing')
      return kit.descriptor.pending[`savings-${role}`].address as string
    },
    { id: vaultId, role: claimant, storePath: KIT_STORE_MODULE },
  )
  await page.route('**/esplora/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === `/esplora/address/${address}/utxo`) return json(route, [utxo])
    if (url.pathname === '/esplora/blocks/tip/height') return route.fulfill({ status: 200, body: '20' })
    return route.fallback()
  })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByTestId('initiate-alert')).toBeVisible()
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
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_ORIGIN })
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

test('opens a confirmed Spending activity in its transaction detail view', async ({ page }) => {
  const { status } = await openVault(page)
  await setOperatorVtxos([await wireVtxo(page, status, { amount: 25_000, txid: VTXO_TXID })])
  await dispatchUtxoUpdate(page, status.vaultId)

  await page.getByTestId(`vault-tx-${VTXO_TXID}`).click()
  await expect(page.getByRole('heading', { name: 'Received' })).toBeVisible()
  await expect(page.getByText('25,000 SATS', { exact: true })).toBeVisible()
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()
  await expect(page.getByText('Spending', { exact: true })).toBeVisible()
  await expect(page.getByText(VTXO_TXID, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'View on Arkade Space' })).toBeVisible()

  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('account-switcher')).toBeVisible()
})

test('accepts a BOLT11 send input and renders persisted Lightning failure and refund states', async ({ page }) => {
  await page.clock.setFixedTime(new Date((MUTINYNET_INVOICE_TIMESTAMP + 1) * 1_000))
  const { status } = await openVault(page)
  await setOperatorVtxos([await wireVtxo(page, status, { amount: 20_000, txid: VTXO_TXID })])
  await dispatchUtxoUpdate(page, status.vaultId)

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByPlaceholder('Arkade address or Lightning invoice').fill(MUTINYNET_INVOICE)
  await expect(page.getByTestId('vault-send-amount')).toHaveValue('2100')
  await expect(page.getByTestId('vault-send-amount')).toHaveAttribute('readonly', '')
  await expect(page.getByText('The solver and VTXO fees appear on the next screen.')).toBeVisible()
  await page.getByRole('button', { name: 'Go back' }).click()

  const failedTxid = '91'.repeat(32)
  const returnableTxid = '92'.repeat(32)
  const refundedTxid = '93'.repeat(32)
  await seedLightningActivity(page, status, {
    rfqId: '81'.repeat(32),
    fundingTxid: failedTxid,
    state: 'failed',
  })
  await seedLightningActivity(page, status, {
    rfqId: '82'.repeat(32),
    fundingTxid: returnableTxid,
    state: 'needs_counterparty',
  })
  await seedLightningActivity(page, status, {
    rfqId: '83'.repeat(32),
    fundingTxid: refundedTxid,
    state: 'refunded',
  })
  await dispatchUtxoUpdate(page, status.vaultId)

  await expect(page.getByTestId(`vault-tx-${failedTxid}`)).toContainText('Needs recovery')
  await expect(page.getByTestId(`vault-tx-${returnableTxid}`)).toContainText('Ready to return')
  await expect(page.getByTestId(`vault-tx-${refundedTxid}`)).toContainText('Refunded')

  await page.getByTestId(`vault-tx-${failedTxid}`).click()
  await expect(page.getByRole('heading', { name: 'Lightning payment' })).toBeVisible()
  await expect(page.getByText('Needs recovery', { exact: true })).toBeVisible()
  await expect(page.getByText('2,100 SATS', { exact: true })).toBeVisible()
  await expect(page.getByText('75 SATS', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return to Spending' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByTestId(`vault-tx-${returnableTxid}`).click()
  await expect(page.getByText('Ready to return', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return to Spending' })).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()

  await page.getByTestId(`vault-tx-${refundedTxid}`).click()
  await expect(page.getByText('Refunded', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return to Spending' })).toHaveCount(0)
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
  await context.setOffline(true)
  await setOperatorVtxos([
    { ...cached, isSpent: true, spentBy: nextTxid, arkTxid: nextTxid },
    await wireVtxo(page, status, { amount: 30_000, txid: nextTxid }),
  ])
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
  await expect(page.getByText('20,000 remaining of 100,000 in your rolling 24-hour limit')).toBeVisible()
  await page.getByTestId('vault-send-amount').fill('12000')
  await page.getByPlaceholder('Arkade address or Lightning invoice').fill(destination)
  await page.getByRole('button', { name: 'Review payment' }).click()

  await expect(page.getByRole('heading', { name: 'Review payment' })).toBeVisible()
  await expect(page.getByText('12,000 SATS', { exact: true })).toBeVisible()
  await expect(page.getByText(destination, { exact: true })).toBeVisible()
  await expect(page.getByText('500 SATS', { exact: true })).toBeVisible()
  await expect(page.getByText('12,500 SATS', { exact: true })).toBeVisible()
  await expect(page.getByText('Vault service', { exact: true })).toBeVisible()
  await expect(page.getByText('Approves within your enrolled limits', { exact: true })).toBeVisible()
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

  await expect(page.getByTestId('vault-balance')).toContainText('0')
  await expect(page.getByTestId('spending-pending')).toContainText('50,000 sats arriving')
  await expect(page.getByTestId('spending-total')).toContainText('50,000 sats total')
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
  await expect(page.getByTestId('vault-balance')).toContainText('20,000')
  await expect(page.getByTestId('spending-pending')).toContainText('50,000 sats arriving')
  await expect(page.getByTestId('spending-total')).toContainText('70,000 sats total')

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByTestId('vault-send-amount').fill('30000')
  await page.getByPlaceholder('Arkade address or Lightning invoice').fill(destination)
  await page.getByRole('button', { name: 'Review payment' }).click()

  await expect(page.getByText('Not enough confirmed spending funds.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Review' })).toHaveCount(0)
})

async function openSecurity(page: Page) {
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByTestId('tab-vault').click()
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
}

test('validates a pasted Recovery Kit against its committed descriptor', async ({ page }) => {
  const { status } = await openVault(page)
  const validKit = await recoveryKitJson(page, status.vaultId)
  const tampered = JSON.parse(validKit) as Record<string, unknown>
  tampered.descriptorHash = '00'.repeat(32)

  await openSecurity(page)
  await page.getByTestId('security-kit').click()
  await expect(page.getByRole('heading', { name: 'Recovery Kit' })).toBeVisible()
  await page.getByRole('button', { name: 'I already have a kit file' }).click()

  const input = page.getByTestId('recovery-kit-json')
  await input.fill(JSON.stringify(tampered))
  await expect(page.getByText('Recovery Kit hash does not match the rebuilt descriptor')).toBeVisible()

  await input.fill(validKit)
  await expect(page.getByText(/This kit is for vault e2e-vaul… · 7 addresses/)).toBeVisible()
  await expect(page.getByText('Recovery Kit hash does not match the rebuilt descriptor')).toHaveCount(0)
})

test('starts recovery only from a confirmed Savings coin and fences a second destination', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3003' })
  const { state, status } = await openVault(page)
  const coin: EsploraUtxo = {
    txid: '71'.repeat(32),
    vout: 0,
    value: 50_000,
    status: { confirmed: true, block_height: 1 },
  }

  await openSecurity(page)
  await page.getByTestId('security-lost').click()
  await expect(page.getByRole('heading', { name: 'Lost a key' })).toBeVisible()

  await page.getByTestId('recover-initiate').click()
  await expect(page.getByText('No confirmed coin on that account')).toBeVisible()

  state.savingsUtxos = [coin]
  await page.getByTestId('recover-initiate').click()
  await expect(page.getByText('Transaction copied. Sign it with the key you still have.')).toBeVisible()
  const psbt = await page.evaluate(() => navigator.clipboard.readText())
  const initiation = await page.evaluate(
    async ({ id, kitPath, rawPsbt, spendPath }) => {
      const [kitStore, spend] = await Promise.all([
        import(/* @vite-ignore */ kitPath),
        import(/* @vite-ignore */ spendPath),
      ])
      const kit = kitStore.loadLocalKit(id)
      if (!kit) throw new Error('Recovery Kit fixture is missing')
      return {
        expectedDestScript: kit.descriptor.pending['savings-hardware'].script,
        view: spend.inspectTransitionPsbt(rawPsbt),
      }
    },
    { id: status.vaultId, kitPath: KIT_STORE_MODULE, rawPsbt: psbt, spendPath: RECOVERY_SPEND_MODULE },
  )
  expect(initiation.view).toMatchObject({
    destScript: initiation.expectedDestScript,
    destSats: 49_260,
    feeSats: 500,
    inputVout: 0,
  })

  await page.getByTestId('recover-key-phone').click()
  await page.getByTestId('recover-initiate').click()
  await expect(page.getByText('second dest for this outpoint')).toBeVisible()
})

test('surfaces a mature recovery and preserves claimant-aware guardian cancellation', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3003' })
  const { status } = await openVault(page)
  const coin: EsploraUtxo = {
    txid: '72'.repeat(32),
    vout: 1,
    value: 20_000,
    status: { confirmed: true, block_height: 1 },
  }
  await installPendingRecovery(page, status.vaultId, 'hardware', coin)

  const alert = page.getByTestId('initiate-alert')
  await expect(alert).toContainText('Someone started recovery on Savings with hardware.')
  await alert.click()
  await expect(page.getByRole('heading', { name: 'Lost a key' })).toBeVisible()
  await expect(page.getByText('Recovery in process', { exact: true })).toBeVisible()

  await page.getByTestId('recover-claim-dest').fill(status.savingsAddress)
  await page.getByTestId('recover-claim').click()
  const claimPsbt = await page.evaluate(() => navigator.clipboard.readText())
  const claim = await page.evaluate(
    async ({ rawPsbt, spendPath }) => {
      const spend = await import(/* @vite-ignore */ spendPath)
      return spend.inspectClaimPsbt(rawPsbt)
    },
    { rawPsbt: claimPsbt, spendPath: RECOVERY_SPEND_MODULE },
  )
  expect(claim).toMatchObject({
    sequence: 6,
    destScript: status.savingsScript,
    destSats: 19_500,
    feeSats: 500,
  })

  await page.getByTestId('recover-guardian-exit').click()
  await expect(page.getByTestId('recover-guardian-signers')).toContainText('This device and Recovery')
  await expect(page.getByTestId('recover-guardian-signers')).not.toContainText('Hardware and')
  await expect(page.getByTestId('recover-guardian-device')).toBeVisible()
  await expect(page.getByTestId('recover-guardian-external')).toContainText('Recovery')

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('recover-guardian-external-download').click()
  const download = await downloadPromise
  const path = await download.path()
  if (!path) throw new Error('cancel PSBT download path is missing')
  const unsignedCancel = await readFile(path)
  await page.getByTestId('recover-guardian-signed-psbt').fill(unsignedCancel.toString('hex'))
  await page.getByTestId('recover-guardian-external').click()
  await expect(page.getByText('signed cancel must add exactly one signature')).toBeVisible()
  await expect(page.getByTestId('recover-guardian-broadcast')).toHaveCount(0)
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
  await app.evaluate((element) => element.style.setProperty('--vault-safe-area-top', '47px'))

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
  expect(navigationTrigger!.y + navigationTrigger!.height).toBe(viewport!.height)
  expect(statusBarOverlay).toBe('none')
  await expectNoHorizontalOverflow(page)
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

  await expect(page.getByTestId('vault-balance')).toContainText('80,000')
  await expect(page.getByTestId('spending-pending')).toContainText('48,000 sats arriving')
  await expect(page.getByTestId('spending-total')).toContainText('128,000 sats total')
  await expect
    .poll(() => page.locator('.vault-home-hero').evaluate((element) => getComputedStyle(element, '::after').content))
    .toBe('none')
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('home-with-pending.png', { animations: 'disabled', fullPage: true })

  const accountTrigger = page.getByTestId('account-switcher')
  await accountTrigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('home-account-menu.png', { animations: 'disabled', fullPage: true })
  await page.keyboard.press('Escape')
  await expect(accountTrigger).toBeFocused()

  await page.getByTestId('account-scan').click()
  await expect(page.getByRole('heading', { name: 'Payment request' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('payment-scanner.png', { animations: 'disabled', fullPage: true })
  const cancelScanner = page.getByRole('button', { name: 'Cancel' })
  if (await cancelScanner.isVisible()) await cancelScanner.click().catch(() => undefined)
  await expect(page.getByRole('heading', { name: 'Send' })).toBeVisible()
  await page.getByRole('button', { name: 'Go back' }).click()

  await page.getByTestId('account-receive').click()
  await expect(page.getByRole('heading', { name: 'Receive to Spending' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('receive-spending.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()

  await accountTrigger.focus()
  await page.keyboard.press('ArrowDown')
  const spendingOption = page.getByRole('menuitemradio', { name: /Spending/ })
  await expect(spendingOption).toHaveAttribute('aria-checked', 'true')
  await expect(spendingOption).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(accountTrigger).toContainText('Savings')
  await accountTrigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: /Savings/ })).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('Enter')
  await expect(accountTrigger).toContainText('Spending')

  await seedReviewedSpend(page, status, destination, 12_000, 500, 67_500)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('send-spending.png', { animations: 'disabled', fullPage: true })
  await page.getByTestId('vault-send-amount').fill('12000')
  await page.getByPlaceholder('Arkade address or Lightning invoice').fill(destination)
  await page.getByRole('button', { name: 'Review payment' }).click()
  await expect(page.getByRole('heading', { name: 'Review payment' })).toBeVisible()
  await expect(page.getByText('Mutinynet', { exact: true })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('send-review.png', { animations: 'disabled', fullPage: true })
  await expectReachableAbove(page, '.vault-review-approvals', '.buttons-on-bottom')

  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByTestId('tab-vault').click()
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
  await expect(page.getByTestId('security-readiness')).toContainText('Ready')
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('security.png', { animations: 'disabled', fullPage: true })
  await expectReachableAbove(page, '[data-testid="security-lost"]', '.vault-navigation-trigger')

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
  await expect(page.getByRole('heading', { name: 'Sign out' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('settings-signout.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()

  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByTestId('tab-wallet').click()
  await page.getByRole('button', { name: /Received 80,000 SATS/ }).click()
  await expect(page.getByRole('heading', { name: 'Received' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('transaction-received.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()

  await setEsploraState(status, state)
  await page.getByTestId('account-switcher').click()
  await page.getByTestId('account-savings').click()
  await expect(page.getByTestId('account-switcher')).toContainText('Savings')
  await refreshHome(page)
  await expect(page.getByTestId('vault-balance')).toContainText('100,000')
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('home-savings.png', { animations: 'disabled', fullPage: true })
  await page.getByTestId('account-receive').click()
  await expect(page.getByRole('heading', { name: 'Add to Savings' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('receive-savings.png', { animations: 'disabled', fullPage: true })
  await page.getByRole('button', { name: 'Go back' }).click()
  await page.getByRole('button', { name: 'Move to Spending' }).click()
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

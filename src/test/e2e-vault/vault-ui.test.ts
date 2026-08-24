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

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function setOperatorVtxos(vtxos: Record<string, unknown>[] = []) {
  const response = await fetch(OPERATOR_CONTROL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vtxos }),
  })
  if (!response.ok) throw new Error(`Operator fixture reset failed: ${response.status}`)
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

async function openVault(page: Page, initial: Partial<VaultUiState> = {}) {
  let status: VaultStatus | undefined
  const state: VaultUiState = {
    boardingUtxos: initial.boardingUtxos || [],
    savingsTxs: initial.savingsTxs || [],
    savingsUtxos: initial.savingsUtxos || [],
  }
  await installRoutes(page, () => status, state)
  await setOperatorVtxos()
  await page.goto('/')
  const installed = await page.evaluate(async (fixturePath) => {
    const fixture = await import(/* @vite-ignore */ fixturePath)
    return { destination: fixture.VAULT_UI_DESTINATION, status: fixture.installVaultUiSession() }
  }, UI_FIXTURE)
  const currentStatus = installed.status as VaultStatus
  status = currentStatus
  await page.reload()
  await expect(page.getByTestId('account-switcher')).toBeVisible()
  try {
    await expect(page.getByTestId('vault-balance')).not.toHaveText('—', { timeout: 15_000 })
  } catch (error) {
    const operator = await fetch(OPERATOR_CONTROL).then((response) => response.text())
    throw new Error(`Vault Home did not finish loading. Operator fixture: ${operator}`, { cause: error })
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
  await expect(page.getByTestId(`vault-tx-${VTXO_TXID}`)).toContainText('Confirmed')
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

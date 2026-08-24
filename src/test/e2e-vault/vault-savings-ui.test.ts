import { expect, test, type Page, type Route } from '@playwright/test'
import type { VaultStatus } from '../../lib/vault/types'

const AMOUNT = 50_000
const FEE = 1_500
const UI_FIXTURE = '/src/test/e2e-vault/fixtures/vault-ui.ts'
const ENROLLMENT_MODULE = '/src/lib/vault/enrollmentStore.ts'
const HANDOFF_MODULE = '/src/lib/vault/savingsHandoff.ts'
const SAVINGS_MODULE = '/src/lib/vault/savingsSpend.ts'
const PROGRAM_FIXTURE_MODULE = '/src/lib/vault/program/fixtures.ts'

function json(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function openVault(page: Page): Promise<VaultStatus> {
  let status: VaultStatus | undefined
  await page.route('**/v1/status*', (route) =>
    json(
      route,
      new URL(route.request().url()).searchParams.has('vault')
        ? status
        : {
            network: 'mutinynet',
            clientOrigin: 'http://localhost:3003',
            rpId: 'localhost',
            templateVersion: 'phone-hww-recovery-savings-v1',
            policyVersion: 'vault-spending-policy-v1',
            enrollmentMode: 'token',
          },
    ),
  )
  await page.route('**/esplora/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/esplora/blocks/tip/height') return route.fulfill({ status: 200, body: '1' })
    return json(route, [])
  })
  await page.goto('/')
  status = (await page.evaluate(async (fixturePath) => {
    const fixture = await import(/* @vite-ignore */ fixturePath)
    return fixture.installVaultUiSession()
  }, UI_FIXTURE)) as VaultStatus
  await page.reload()
  await expect(page.getByTestId('account-switcher')).toBeVisible()
  return status
}

async function selectSavings(page: Page) {
  await page.getByTestId('account-switcher').click()
  await page.getByTestId('account-savings').click()
  await expect(page.getByTestId('account-switcher')).toContainText('Savings')
}

async function createPhoneSignedPendingTransfer(page: Page, status: VaultStatus): Promise<string> {
  return page.evaluate(
    async ({ amount, enrollmentPath, fee, fixturePath, handoffPath, savingsPath, vaultStatus }) => {
      const enrollmentStore = await import(/* @vite-ignore */ enrollmentPath)
      const handoff = await import(/* @vite-ignore */ handoffPath)
      const savings = await import(/* @vite-ignore */ savingsPath)
      const fixtures = await import(/* @vite-ignore */ fixturePath)
      const enrollment = enrollmentStore.loadEnrollment(localStorage, vaultStatus.vaultId)
      if (!enrollment) throw new Error('test enrollment is missing')
      const unsigned = savings.buildSavingsPsbt({
        status: vaultStatus,
        phonePub: enrollment.phoneBip340Pub,
        destAddress: vaultStatus.vtxoBoardingAddress,
        amountSats: amount,
        feeSats: fee,
        coins: [{ txid: '77'.repeat(32), vout: 0, value: amount + fee, confirmedHeight: 1 }],
        leaf: 'admin',
      })
      const secret = fixtures.scalarSecret(3)
      try {
        const signed = savings.signSavingsPsbt(unsigned, secret)
        handoff.savePendingSavingsHandoff(
          localStorage,
          handoff.createPendingSavingsHandoff({
            vaultId: vaultStatus.vaultId,
            psbtHex: signed,
            destAddress: vaultStatus.vtxoBoardingAddress,
            amountSats: amount,
            feeSats: fee,
            network: vaultStatus.network,
          }),
        )
        return signed
      } finally {
        secret.fill(0)
      }
    },
    {
      amount: AMOUNT,
      enrollmentPath: ENROLLMENT_MODULE,
      fee: FEE,
      fixturePath: PROGRAM_FIXTURE_MODULE,
      handoffPath: HANDOFF_MODULE,
      savingsPath: SAVINGS_MODULE,
      vaultStatus: status,
    },
  )
}

test('persists a phone-signed Savings PSBT and supports copy, paste, upload, and deletion', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3003' })
  const status = await openVault(page)
  const psbtHex = await createPhoneSignedPendingTransfer(page, status)

  await page.reload()
  await selectSavings(page)
  const pending = page.getByRole('button', { name: /Waiting for hardware 51,500 SATS/i })
  await expect(pending).toBeVisible()

  await page.reload()
  await selectSavings(page)
  await page.getByRole('button', { name: /Waiting for hardware 51,500 SATS/i }).click()
  await expect(page.getByRole('heading', { name: 'Hardware next' })).toBeVisible()

  await page.getByRole('button', { name: 'Copy PSBT' }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toMatch(/^cHNidP/)

  await page.getByTestId('savings-signed-psbt-paste').fill(copied)
  await expect(page.getByRole('button', { name: 'Broadcast' })).toBeEnabled()

  await page.getByTestId('savings-signed-psbt-file').setInputFiles({
    name: 'hardware-signed.psbt',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(psbtHex, 'hex'),
  })
  await expect(page.getByText('hardware-signed.psbt is ready to broadcast.')).toBeVisible()

  await page.getByRole('button', { name: 'Delete pending transfer' }).click()
  await expect(page.getByTestId('account-switcher')).toContainText('Savings')
  await expect(page.getByRole('button', { name: /Waiting for hardware/i })).toHaveCount(0)
  await expect
    .poll(() => page.evaluate((id) => localStorage.getItem(`arkade-vault-savings-handoff-v1:${id}`), status.vaultId))
    .toBeNull()
})

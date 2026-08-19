import { expect, test, type Page } from '@playwright/test'
import { DEMO_HARDWARE_PUB } from '../../lib/vault/setupPlan'

async function setupToThisDevice(page: Page) {
  await page.goto('/')
  await expect(page.getByText('Your vault')).toBeVisible()
  await page.getByRole('button', { name: 'Set up' }).click()

  await expect(page.getByText('How it works', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText('Add hardware', { exact: true })).toBeVisible()
  await page.getByTestId('hardware-pub').fill(DEMO_HARDWARE_PUB)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()
  await expect(page.getByText(/waiting period/i)).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(page.getByText('Daily limits', { exact: true })).toBeVisible()
  await page.getByTestId('cap-20000').click()
  await page.getByTestId('daily-50000').click()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText('Your setup', { exact: true })).toBeVisible()
  await expect(page.getByText('Skipped. This device plus hardware only.')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
}

test('skips optional recovery and reaches the vault home', async ({ page }) => {
  await setupToThisDevice(page)

  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(page.getByTestId('vault-balance')).toBeVisible()
  await expect(page.getByTestId('account-switcher')).toContainText(/Spending/)
  await page.getByTestId('tab-vault').click()
  await expect(page.getByTestId('security-kit')).toBeVisible()
  await expect(page.getByTestId('security-lost')).toBeVisible()

  await page.getByTestId('security-kit').click()
  await expect(page.getByTestId('screen-title')).toHaveText('Recovery Kit')
  await expect(page.getByText(/map of this vault/i)).toBeVisible()
  await page.getByRole('button', { name: /I lost a key/ }).click()
  await expect(page.getByText('Lost a key')).toBeVisible()
  await expect(page.getByText(/remaining keys/i)).toBeVisible()
  await expect(page.getByTestId('recover-initiate')).toBeVisible()
  await expect(page.getByTestId('recover-guardian-exit')).toHaveCount(0)
})

test('this-device screen has a virtual authenticator before skip', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const authenticator = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  expect(authenticator.authenticatorId).toBeTruthy()
  await setupToThisDevice(page)
  await expect(page.getByRole('button', { name: /Create this device|Use Face ID/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()
})

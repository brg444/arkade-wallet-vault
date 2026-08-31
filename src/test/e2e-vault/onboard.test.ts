import { expect, test, type Page } from '@playwright/test'
import { PROGRAM_FIXTURE } from '../../lib/vault/program/fixtures'

async function setupToThisDevice(page: Page) {
  await page.goto('/')
  await expect(page.getByText('Spending and Savings, together')).toBeVisible()
  await page.getByRole('button', { name: 'Set up a new vault' }).click()

  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Add hardware' })).toBeVisible()
  await page.getByTestId('hardware-pub').fill(PROGRAM_FIXTURE.hardwarePub)
  await page.getByRole('button', { name: 'Use this hardware key' }).click()

  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()
  await expect(page.getByText(/waiting period/i)).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(page.getByRole('heading', { name: 'Spending limits' })).toBeVisible()
  await page.getByRole('button', { name: 'Review setup' }).click()

  await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible()
  await expect(page.getByText('Skipped. This device plus hardware only.')).toBeVisible()
  await page.getByRole('button', { name: 'Secure this device' }).click()
}

test('this-device screen requires an invite and has a virtual authenticator', async ({ page, context }) => {
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
  await expect(page.getByRole('button', { name: 'Secure this device' })).toBeVisible()
  await expect(page.getByTestId('enrollment-token')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Secure this device' })).toBeDisabled()
})

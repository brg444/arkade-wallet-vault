import { expect, test, type Page } from '@playwright/test'
import { PROGRAM_FIXTURE } from '../../lib/vault/program/fixtures'

async function setupToThisDevice(page: Page) {
  await page.goto('/')
  await expect(page.getByText('Your vault')).toBeVisible()
  await page.getByRole('button', { name: 'Set up' }).click()

  await expect(page.getByText('How it works', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText('Add hardware', { exact: true })).toBeVisible()
  await page.getByTestId('hardware-pub').fill(PROGRAM_FIXTURE.hardwarePub)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()
  await expect(page.getByText(/waiting period/i)).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(page.getByText('Daily limits', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText('Your setup', { exact: true })).toBeVisible()
  await expect(page.getByText('Skipped. This device plus hardware only.')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
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
  await expect(page.getByRole('button', { name: /Create this device|Use Face ID/ })).toBeVisible()
  await expect(page.getByTestId('enrollment-token')).toBeVisible()
  await expect(page.getByRole('button', { name: /Create this device|Use Face ID/ })).toBeDisabled()
})

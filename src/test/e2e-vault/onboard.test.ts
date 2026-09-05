import { expect, test, type Page } from '@playwright/test'
import { PROGRAM_FIXTURE } from '../../lib/vault/program/fixtures'

async function setupToThisDevice(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Everyday spending/ })).toBeVisible()
  await page.getByRole('button', { name: 'Get started' }).click()

  await expect(page.getByRole('heading', { name: 'Everyday spending, protected savings' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Add your hardware key' })).toBeVisible()
  await page.getByTestId('hardware-pub').fill(PROGRAM_FIXTURE.hardwarePub)
  await page.getByRole('button', { name: 'Use this hardware key' }).click()

  await expect(page.getByRole('heading', { name: 'How should recovery work?' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue with Standard' }).click()

  await expect(page.getByRole('heading', { name: 'Set comfortable limits' })).toBeVisible()
  await page.getByRole('button', { name: 'Review setup' }).click()

  await expect(page.getByRole('heading', { name: 'Review your Vault' })).toBeVisible()
  await expect(page.getByText('Not enrolled')).toBeVisible()
  await page.getByRole('checkbox').check()
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
  await expect(page.getByRole('button', { name: 'Create Vault' })).toBeVisible()
  await expect(page.getByTestId('enrollment-token')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create Vault' })).toBeDisabled()
})

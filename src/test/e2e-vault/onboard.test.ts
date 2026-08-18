import { expect, test } from '@playwright/test'
import { DEMO_HARDWARE_PUB } from '../../lib/vault/setupPlan'

test('skips optional recovery and reaches the vault home', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Your vault')).toBeVisible()
  await page.getByRole('button', { name: 'Set up' }).click()

  await expect(page.getByText('How it works', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText('Which hardware?', { exact: true })).toBeVisible()
  await page.getByTestId('hardware-pub').fill(DEMO_HARDWARE_PUB)
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText('Recovery key', { exact: true })).toBeVisible()
  await expect(page.getByText(/waiting period/i)).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(page.getByText('How much can this device send?', { exact: true })).toBeVisible()
  await page.getByTestId('cap-20000').click()
  await page.getByTestId('daily-50000').click()
  await page.getByRole('button', { name: 'Save these rules' }).click()

  await expect(page.getByText('Review', { exact: true })).toBeVisible()
  await expect(page.getByText('Skipped. Device + hardware only.')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByText('Passkey', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(page.getByTestId('vault-balance')).toBeVisible()
  await expect(page.getByTestId('account-switcher')).toContainText(/Spending/)
  await page.getByTestId('tab-settings').click()
  await expect(page.getByTestId('settings-recover')).toBeVisible()
  await expect(page.getByTestId('settings-kit')).toBeVisible()
})

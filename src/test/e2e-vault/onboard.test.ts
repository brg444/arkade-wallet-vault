import { expect, test } from '@playwright/test'
import { DEMO_HARDWARE_PUB } from '../../lib/vault/setupPlan'

test('skips optional recovery and reaches the vault home', async ({ page }) => {
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

  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()

  await expect(page.getByTestId('vault-balance')).toBeVisible()
  await expect(page.getByTestId('account-switcher')).toContainText(/Spending/)
  await page.getByTestId('tab-vault').click()
  await expect(page.getByTestId('security-kit')).toBeVisible()
  await expect(page.getByTestId('security-lost')).toBeVisible()
})

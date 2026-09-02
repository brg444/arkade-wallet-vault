import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

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

test('@polish welcome is accessible and visually stable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Spending and Savings, together')).toBeVisible()
  await expect(page.getByText('Mutinynet only. Don’t send real Bitcoin.')).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('welcome.png', { animations: 'disabled', fullPage: true })

  await page.getByRole('button', { name: 'Set up a new vault' }).click()
  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('onboarding-how-it-works.png', { animations: 'disabled', fullPage: true })
})

test('@polish render failures are safe, accessible, and visually stable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, 'randomUUID', {
      configurable: true,
      value: () => '00000000-0000-4000-8000-000000000000',
    })
    Object.defineProperty(Storage.prototype, 'getItem', {
      configurable: true,
      value() {
        throw new Error(`raw render payload tb1q${'q'.repeat(40)}`)
      },
    })
  })
  await page.goto('/')
  await expect(page.getByText('Arkade Vault could not display this screen.')).toBeVisible()
  await expect(page.getByText(/^Incident reference: VLT-/)).toBeVisible()
  await expect(page.getByText(/raw render payload/)).toHaveCount(0)
  await expectNoBlockingAxeViolations(page)
  await expect(page).toHaveScreenshot('render-error.png', { animations: 'disabled', fullPage: true })
})

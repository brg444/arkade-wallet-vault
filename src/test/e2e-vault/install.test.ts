import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

for (const dark of [false, true]) {
  test(`@polish @visual-refinement welcome install guide is accessible and dismissible (${dark ? 'dark' : 'light'})`, async ({
    page,
  }, testInfo) => {
    await page.goto('/')
    await page.evaluate((value) => document.documentElement.classList.toggle('palette-dark', value), dark)
    const trigger = page.getByRole('button', { name: /Install Vaulted/ })
    await expect(trigger).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await trigger.click()
      const sheet = page.getByRole('dialog', { name: 'Install Vaulted', exact: true })
    await expect(sheet).toBeVisible()
    const iphone = await page.evaluate(() => /iPhone|iPad/.test(navigator.userAgent))
    if (iphone) await expect(sheet.getByText('Add to Home Screen', { exact: true })).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
    expect(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('install-guide.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await expect(sheet).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await sheet.getByRole('button', { name: 'Continue in browser' }).click()
    await expect(sheet).not.toBeVisible()
    await page.getByRole('button', { name: 'Get started', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'How it works', exact: true })).toBeVisible()
  })
}

test('@visual-refinement installed welcome hides the install notice', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Install Vaulted/ })).toHaveCount(0)
})

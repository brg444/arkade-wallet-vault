import { expect, test } from '@playwright/test'

test('iOS direct haptic target preserves the underlying button action', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'no-preference',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    viewport: { width: 390, height: 844 },
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined })
  })

  const page = await context.newPage()
  await page.goto(baseURL ?? '/')
  const button = page.getByRole('button', { name: 'Get started' })
  await expect(button).toBeVisible()

  const buttonIndex = await button.evaluate((element) =>
    Array.from(document.querySelectorAll('button')).indexOf(element as HTMLButtonElement),
  )
  const overlay = page.locator('#vault-ios-haptic-overlays input[switch]').nth(buttonIndex)
  await expect(overlay).toBeAttached()
  await overlay.click({ force: true })

  await expect(page.getByRole('heading', { name: 'How it works' })).toBeVisible()
  await context.close()
})

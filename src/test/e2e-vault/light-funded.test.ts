import { expect, test } from './fixtures/passkey'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { schnorr } from '@noble/curves/secp256k1.js'
import { p2tr } from '@scure/btc-signer'
import { hex } from '@scure/base'
import { getNetwork } from '@arkade-os/sdk'

test.skip(process.env.VAULT_LIGHT_LIVE !== 'mutinynet', 'Opt-in funded Mutinynet drill only')
test('Light enrolls, receives and pays with real Mutinynet providers', async ({ page, passkey }) => {
  const directory = process.env.VAULT_LIGHT_DRILL_DIRECTORY!
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const save = async (name: string, value: unknown) =>
    writeFile(join(directory, name), JSON.stringify(value, null, 2), { mode: 0o600 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.hostname !== 'localhost') return route.continue()
    const response = await page.request.fetch(`http://127.0.0.1:18899${url.pathname}${url.search}`, {
      method: request.method(),
      headers: request.headers(),
      data: request.postData() || undefined,
    })
    await route.fulfill({ response })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Get started', exact: true }).click()
  await page.getByRole('button', { name: 'Light Passkey spending', exact: false }).click()
  await page.getByLabel('Per-payment limit, in sats').fill('20000')
  await page.getByLabel('Rolling 24-hour limit, in sats').fill('50000')
  await page.getByRole('button', { name: 'Create passkey', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Keep two things safe' })).toBeVisible()
  const secret = (await page.locator('.light-secret').innerText()).trim()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download recovery file', exact: true }).click()
  const path = await (await downloadPromise).path()
  const saved = JSON.parse(await readFile(path!, 'utf8'))
  const destinationKey = schnorr.utils.randomSecretKey()
  const destination = p2tr(schnorr.getPublicKey(destinationKey), undefined, getNetwork('mutinynet')).address!
  await save('browser-owner-backup.json', {
    saved,
    secret,
    credentials: await passkey.credentials(),
    destination,
    destinationKey: hex.encode(destinationKey),
  })
  destinationKey.fill(0)
  await page.getByLabel('Choose the saved recovery file to verify it').setInputFiles(path!)
  await page.getByLabel('Enter your saved secret to verify').fill(secret)
  await page.getByRole('button', { name: 'Verify backup and create wallet' }).click()
  await expect(page.getByRole('heading', { name: '0 sats', exact: true })).toBeVisible({ timeout: 45000 })
  await page.getByRole('button', { name: 'Receive', exact: true }).click()
  const address = (await page.locator('.light-address').innerText()).trim()
  await save('browser-funding-request.json', { address, amount: 50000 })
  const funded = await page.request.post('https://faucet.mutinynet.arkade.sh/faucet', {
    data: { address, amount: 50000 },
  })
  expect(funded.ok()).toBe(true)
  await page.reload()
  await page.getByRole('button', { name: 'Unlock with passkey', exact: true }).click()
  await expect(page.getByRole('heading', { name: '50,000 sats', exact: true })).toBeVisible({ timeout: 60000 })
  const recipient = await (await page.request.get('https://faucet.mutinynet.arkade.sh/address')).json()
  expect(recipient.offchain).toMatch(/^tark1/)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByLabel('Arkade address', { exact: true }).fill(recipient.offchain)
  await page.getByLabel('Amount, in sats').fill('10000')
  await page.getByRole('button', { name: 'Review payment', exact: true }).click()
  await page.getByRole('button', { name: 'Approve 10,000 sats', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Payment sent', level: 1, exact: true })).toBeVisible({
    timeout: 60000,
  })
  await save('browser-payment-evidence.json', { text: await page.locator('.light-app').innerText(), errors })
  expect(errors).toEqual([])
})

test('Light prepares recovery of funded change without a passkey', async ({ page }) => {
  const directory = process.env.VAULT_LIGHT_DRILL_DIRECTORY!
  const { saved, secret, destination } = JSON.parse(
    await readFile(join(directory, 'browser-owner-backup.json'), 'utf8'),
  )
  expect(destination).toMatch(/^tb1p/)
  await page.addInitScript(() => localStorage.setItem('vaulted:active-setup', 'light'))
  await page.goto('/')
  await page.getByRole('button', { name: 'Restore a Light wallet', exact: true }).click()
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) })
  await page.getByRole('button', { name: 'I no longer have my passkey', exact: true }).click()
  await page.getByLabel('Bitcoin address to recover to').fill(destination)
  await page.getByLabel('Recovery secret', { exact: true }).fill(secret)
  const downloaded = page.waitForEvent('download', { timeout: 90000 })
  await page.getByRole('button', { name: 'Prepare emergency exit', exact: true }).click()
  const file = await downloaded
  const exit = JSON.parse(await readFile((await file.path())!, 'utf8'))
  await writeFile(join(directory, 'browser-change-recovery.json'), JSON.stringify(exit, null, 2), { mode: 0o600 })
  expect(exit.exitPackage.vtxos.reduce((sum: number, coin: { value: number }) => sum + coin.value, 0)).toBe(40000)
  expect(exit.exitPackage.vtxos.every((coin: { skipped?: boolean }) => !coin.skipped)).toBe(true)
  await expect(page.getByRole('button', { name: 'Start Bitcoin recovery', exact: true })).toBeVisible()
  const status = await (
    await page.request.get(`http://127.0.0.1:18899/v1/status?vault=${saved.descriptor.vaultId}`)
  ).json()
  expect(status.periodSpent).toBe(10000)
  expect(status.periodRemaining).toBe(40000)
  await writeFile(
    join(directory, 'browser-payment-evidence.json'),
    JSON.stringify(
      {
        vaultId: saved.descriptor.vaultId,
        periodSpent: status.periodSpent,
        periodRemaining: status.periodRemaining,
        outputs: exit.exitPackage.vtxos,
        recoveredSats: exit.exitPackage.totals.recoveredSats,
        preparedWithoutPasskey: true,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
})
